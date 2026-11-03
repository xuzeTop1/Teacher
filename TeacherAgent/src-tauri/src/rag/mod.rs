// 论文 §4.2 的检索相关实现（混合检索融合层）。
pub(crate) mod hybrid;

// 工作项 E 的评测批处理入口：仅测试构建可见，避免进入生产二进制。
#[cfg(test)]
pub(crate) mod eval;
