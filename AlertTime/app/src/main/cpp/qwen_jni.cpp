#include <jni.h>
#include "llama.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {
std::mutex inference_mutex;
std::once_flag initialized;
std::atomic<jlong> cancelled{0};
struct Request {
    jlong id;
    std::chrono::steady_clock::time_point deadline;
};
bool abort_request(void * data) {
    const auto & r = *static_cast<Request *>(data);
    return cancelled.load() == r.id || std::chrono::steady_clock::now() >= r.deadline;
}
bool load_progress(float, void * data) { return !abort_request(data); }
void quiet_log(ggml_log_level, const char *, void *) {}
std::string bytes(JNIEnv * env, jbyteArray input) {
    const auto size = env->GetArrayLength(input);
    std::string result(size, '\0');
    env->GetByteArrayRegion(input, 0, size, reinterpret_cast<jbyte *>(result.data()));
    return result;
}
void check(Request & request) {
    if (abort_request(&request)) throw std::runtime_error("local_cancelled_or_timeout");
}
}

extern "C" JNIEXPORT void JNICALL
Java_com_hxz_alerttime_app_data_localmodel_QwenNative_cancel(JNIEnv *, jobject, jlong id) {
    cancelled.store(id);
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_com_hxz_alerttime_app_data_localmodel_QwenNative_generate(
        JNIEnv * env, jobject, jstring model_path, jbyteArray prompt_bytes,
        jbyteArray grammar_bytes, jlong request_id) {
    try {
        // Kotlin also serializes requests. This lock protects the JNI boundary itself.
        std::unique_lock<std::mutex> lock(inference_mutex, std::try_to_lock);
        if (!lock.owns_lock()) throw std::runtime_error("local_busy");
        std::call_once(initialized, [] {
            llama_log_set(quiet_log, nullptr);
            ggml_log_set(quiet_log, nullptr);
            llama_backend_init();
        });
        Request request{request_id, std::chrono::steady_clock::now() + std::chrono::seconds(120)};
        check(request);
        const char * path_chars = env->GetStringUTFChars(model_path, nullptr);
        if (!path_chars) return nullptr;
        const std::string path(path_chars);
        env->ReleaseStringUTFChars(model_path, path_chars);
        const auto prompt = bytes(env, prompt_bytes);
        const auto grammar = bytes(env, grammar_bytes);
        if (prompt.empty() || prompt.size() > 12000 || grammar.size() > 16000)
            throw std::runtime_error("local_input_size");
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = 0;
        mp.load_mode = LLAMA_LOAD_MODE_MMAP;
        mp.progress_callback = load_progress;
        mp.progress_callback_user_data = &request;
        std::unique_ptr<llama_model, decltype(&llama_model_free)> model(
            llama_model_load_from_file(path.c_str(), mp), llama_model_free);
        if (!model) throw std::runtime_error("local_model_load");
        check(request);
        const auto * vocab = llama_model_get_vocab(model.get());
        const int token_count = -llama_tokenize(vocab, prompt.data(), prompt.size(), nullptr, 0, true, true);
        constexpr int max_output = 512;
        constexpr int context_size = 2048;
        if (token_count <= 0 || token_count + max_output > context_size)
            throw std::runtime_error("local_input_size");
        std::vector<llama_token> tokens(token_count);
        if (llama_tokenize(vocab, prompt.data(), prompt.size(), tokens.data(), tokens.size(), true, true) != token_count)
            throw std::runtime_error("local_tokenize");
        auto cp = llama_context_default_params();
        cp.n_ctx = context_size;
        cp.n_batch = 256;
        cp.n_ubatch = 128;
        cp.n_threads = std::max(1u, std::min(4u, std::thread::hardware_concurrency()));
        cp.n_threads_batch = cp.n_threads;
        cp.no_perf = true;
        cp.abort_callback = abort_request;
        cp.abort_callback_data = &request;
        std::unique_ptr<llama_context, decltype(&llama_free)> ctx(
            llama_init_from_model(model.get(), cp), llama_free);
        if (!ctx) throw std::runtime_error("local_context");
        auto sp = llama_sampler_chain_default_params();
        sp.no_perf = true;
        std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
            llama_sampler_chain_init(sp), llama_sampler_free);
        auto * constrained = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
        if (!constrained) throw std::runtime_error("local_grammar");
        llama_sampler_chain_add(sampler.get(), constrained);
        llama_sampler_chain_add(sampler.get(), llama_sampler_init_greedy());
        for (int offset = 0; offset < token_count; offset += 256) {
            check(request);
            auto batch = llama_batch_get_one(tokens.data() + offset, std::min(256, token_count - offset));
            if (llama_decode(ctx.get(), batch) != 0) throw std::runtime_error("local_decode");
        }
        std::string output;
        bool completed = false;
        for (int i = 0; i < max_output; ++i) {
            check(request);
            auto token = llama_sampler_sample(sampler.get(), ctx.get(), -1);
            if (llama_vocab_is_eog(vocab, token)) { completed = true; break; }
            std::vector<char> piece(256);
            int size = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
            if (size < 0) {
                piece.resize(-size);
                size = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, false);
            }
            if (size < 0) throw std::runtime_error("local_decode");
            output.append(piece.data(), size);
            if (output.size() > 8192) throw std::runtime_error("local_output_size");
            auto batch = llama_batch_get_one(&token, 1);
            if (llama_decode(ctx.get(), batch) != 0) throw std::runtime_error("local_decode");
        }
        check(request);
        if (!completed) throw std::runtime_error("local_output_truncated");
        auto result = env->NewByteArray(output.size());
        if (result) env->SetByteArrayRegion(result, 0, output.size(), reinterpret_cast<const jbyte *>(output.data()));
        return result;
    } catch (const std::exception &) {
        // Fixed text only: llama diagnostics can contain private paths or input text.
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), "local_inference_failed");
        return nullptr;
    }
}
