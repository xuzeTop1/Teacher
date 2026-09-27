# Hybrid retrieval: 100-query overall re-aggregation

This archive reuses the existing opt_B ranking caches and the 100-question
two-human/three-LLM majority-vote QA. No model or embedding service was
called. The 93-query conditional scope is retained for comparability.
The seven queries with no majority-relevant candidate are retained in the
overall_100 scope as zero Hit@3/Hit@5/MRR/NDCG@5 values.

Candidate-pool coverage is therefore 93/100 = 93%; it is separate from
conditional retrieval quality.
