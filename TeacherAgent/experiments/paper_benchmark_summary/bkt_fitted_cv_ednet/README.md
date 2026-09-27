# Training-fold fitted BKT baseline

For each of the four EdNet queues, the five student folds are fixed by seed 42.
The 81-point grid is selected on training-fold predictive Bernoulli NLL only.
The held-out fold is used only once for AUC/ACC/RMSE evaluation. `fixed_bkt`
retains the historical deployment parameters; `fitted_bkt` is the fairness
comparison baseline. Five folds are summarized as exploratory CV estimates,
not five independent replications.
