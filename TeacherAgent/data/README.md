# Data

初始知识库、题库、embedding 或 seed 数据放在这里。正式知识库内容必须符合 `docs/knowledge-base-governance.md`。

当前 seed：

- `knowledge/math-limits.seed.json`：数学 / 高等数学 / 极限与连续，35 个知识节点，覆盖极限、连续、间断点和常见求极限方法。
- `knowledge/linear-algebra-basics.seed.json`：数学 / 线性代数基础，10 个知识节点，覆盖矩阵、行列式、逆矩阵、线性方程组、向量。
- `knowledge/probability-basics.seed.json`：数学 / 概率统计基础，8 个知识节点，覆盖样本空间、事件、古典概型、条件概率、独立性、随机变量、期望、方差。
- `knowledge/math-derivatives.seed.json`：数学 / 导数与微分，8 个知识节点，覆盖导数定义、几何意义、基本公式、乘除法则、链式法则、隐函数、高阶导数、微分。
- `knowledge/math-applications-of-derivatives.seed.json`：数学 / 导数应用，7 个知识节点，覆盖单调性、极值、凹凸性、拐点、作图、最值优化、相关变化率、线性近似。
- `knowledge/math-indefinite-integrals.seed.json`：数学 / 不定积分，7 个知识节点，覆盖原函数、基本公式、线性性质、换元法、分部积分、三角积分、部分分式。
- `knowledge/math-definite-integrals.seed.json`：数学 / 定积分，7 个知识节点，覆盖黎曼和、微积分基本定理、性质、换元、分部、反常积分、数值方法。
- `knowledge/math-integral-applications.seed.json`：数学 / 积分应用，6 个知识节点，覆盖面积、旋转体体积（圆盘法/柱壳法）、弧长、平均值、变力做功。
- `knowledge/math-mean-value-theorems.seed.json`：数学 / 微分中值定理，5 个知识节点，覆盖罗尔定理、拉格朗日中值定理、柯西中值定理、洛必达法则、泰勒中值定理。
- `knowledge/math-multivariable-calculus.seed.json`：数学 / 多元函数微分基础，7 个知识节点，覆盖多元函数、极限、偏导数、全微分、复合求导、梯度、极值。
- `knowledge/probability-distributions.seed.json`：数学 / 概率分布与定理，9 个知识节点，覆盖二项分布、泊松分布、几何分布、正态分布、均匀/指数分布、期望方差性质、贝叶斯公式、大数定律、中心极限定理。
- `knowledge/linear-algebra-expanded.seed.json`：数学 / 线性代数进阶，7 个知识节点，覆盖矩阵的秩、向量空间、线性无关、基与维数、特征值特征向量、对角化、正交性。
- `questions/math-limits.seed.json`：极限与连续 12 道原创题目。
- `questions/linear-algebra-basics.seed.json`：线性代数基础 5 道原创题目。
- `questions/probability-basics.seed.json`：概率统计基础 5 道原创题目。
- `questions/math-derivatives.seed.json`：导数与微分 9 道原创题目。
- `questions/math-applications-of-derivatives.seed.json`：导数应用 8 道原创题目。
- `questions/math-indefinite-integrals.seed.json`：不定积分 8 道原创题目。
- `questions/math-definite-integrals.seed.json`：定积分 7 道原创题目。
- `questions/math-integral-applications.seed.json`：积分应用 7 道原创题目。
- `questions/math-mean-value-theorems.seed.json`：微分中值定理 7 道原创题目。
- `questions/math-multivariable-calculus.seed.json`：多元函数微分 8 道原创题目。
- `questions/probability-distributions.seed.json`：概率分布与定理 10 道原创题目。
- `questions/linear-algebra-expanded.seed.json`：线性代数进阶 6 道原创题目。

总计：122 个知识节点，91 道题目。

注意：seed 数据的 embedding 尚未生成，向量检索当前为 keyword/hybrid mock 模式。

## CS408（408考研）

- `knowledge/cs408-data-structures.seed.json`：CS408 / 数据结构，40 个知识节点，覆盖线性表、栈、队列、树、图、排序、查找、哈希、KMP、B树、AVL、广义表、稀疏矩阵、线索二叉树、外部排序、基数排序等。
- `knowledge/cs408-computer-organization.seed.json`：CS408 / 计算机组成原理，40 个知识节点，覆盖补码、浮点数、IEEE 754、Cache、流水线、指令系统、DMA、总线、Booth 算法、阵列乘法器、微程序控制器等。
- `knowledge/cs408-operating-systems.seed.json`：CS408 / 操作系统，40 个知识节点，覆盖进程、线程、调度、信号量、PV、死锁、银行家算法、分页、虚拟内存、LRU、磁盘调度、管程、读者写者、哲学家进餐等。
- `knowledge/cs408-computer-networks.seed.json`：CS408 / 计算机网络，40 个知识节点，覆盖 OSI、TCP/IP、IP 地址、子网、CIDR、ARP、ICMP、TCP、UDP、拥塞控制、DNS、HTTP、CSMA/CD、CSMA/CA、海明码、滑动窗口等。
- `questions/cs408-data-structures.seed.json`：数据结构 40 道原创题目。
- `questions/cs408-computer-organization.seed.json`：计算机组成原理 40 道原创题目。
- `questions/cs408-operating-systems.seed.json`：操作系统 40 道原创题目。
- `questions/cs408-computer-networks.seed.json`：计算机网络 40 道原创题目。

CS408 小计：160 个知识节点，160 道题目。全部 status: draft，来源为 TeacherAgent original / QoderWork draft。已通过结构校验和人工抽查，但仍建议后续对计算题继续抽样复核。

## Physics（大学物理）

- `knowledge/physics-mechanics.seed.json`：物理 / 力学，9 个知识节点，覆盖质点运动学、牛顿三定律、功与动能定理、动量守恒、刚体转动、角动量、简谐振动、阻尼与受迫振动等。
- `knowledge/physics-electromagnetism.seed.json`：物理 / 电磁学，10 个知识节点，覆盖库仑定律、电场与电势、高斯定理、电容、电流与电阻、磁场与安培环路定理、法拉第电磁感应、麦克斯韦方程组、电磁波等。
- `knowledge/physics-thermodynamics.seed.json`：物理 / 热学，6 个知识节点，覆盖热力学第零/第一/第二/第三定律、理想气体状态方程、熵与熵增原理、卡诺循环等。
- `knowledge/physics-waves-optics.seed.json`：物理 / 波动与光学，9 个知识节点，覆盖波动方程、干涉、衍射、偏振、杨氏双缝、薄膜干涉、单缝衍射、光栅、马吕斯定律等。
- `knowledge/physics-modern.seed.json`：物理 / 近代物理，7 个知识节点，覆盖黑体辐射、光电效应、波粒二象性、原子模型、能级跃迁、核衰变、质能方程、量子数等。
- `questions/physics-mechanics.seed.json`：力学 15 道原创题目。
- `questions/physics-electromagnetism.seed.json`：电磁学 15 道原创题目。
- `questions/physics-thermodynamics.seed.json`：热学 15 道原创题目。
- `questions/physics-waves-optics.seed.json`：波动与光学 15 道原创题目。
- `questions/physics-modern.seed.json`：近代物理 15 道原创题目。

物理小计：41 个知识节点，75 道题目。

## English（考研英语）

- `knowledge/english-grammar.seed.json`：英语 / 长难句语法，20 个知识节点，覆盖限制性/非限制性定语从句、名词性从句嵌套、非谓语动词、虚拟语气、倒装、强调等。
- `knowledge/english-reading.seed.json`：英语 / 阅读逻辑，20 个知识节点，覆盖主旨大意、细节推理、词义猜测、作者态度、论证结构、段落衔接等。
- `knowledge/english-translation.seed.json`：英语 / 翻译得分点，20 个知识节点，覆盖定语从句翻译、被动语态转换、长句拆分、代词指代、增译省译等。
- `knowledge/english-cloze.seed.json`：英语 / 完形填空，20 个知识节点，覆盖逻辑连接词、固定搭配、词义辨析、上下文语境、语法结构等。
- `questions/english-grammar.seed.json`：长难句语法 20 道原创题目。
- `questions/english-reading.seed.json`：阅读逻辑 20 道原创题目。
- `questions/english-translation.seed.json`：翻译得分点 20 道原创题目。
- `questions/english-cloze.seed.json`：完形填空 20 道原创题目。

英语小计：80 个知识节点，80 道题目。status=draft，来源为 WorkBuddy draft。

## Politics（考研政治）

- `knowledge/politics-marxism.seed.json`：政治 / 马克思主义基本原理，20 个知识节点，覆盖唯物论、辩证法、认识论、唯物史观、剩余价值、资本积累等。
- `knowledge/politics-maoism.seed.json`：政治 / 毛泽东思想，20 个知识节点，覆盖新民主主义革命、社会主义改造、实事求是、群众路线、独立自主等。
- `knowledge/politics-history.seed.json`：政治 / 中国近现代史纲要，20 个知识节点，覆盖鸦片战争、辛亥革命、五四运动、抗日战争、解放战争、新中国成立、改革开放等。
- `knowledge/politics-morals.seed.json`：政治 / 思想道德与法治，20 个知识节点，覆盖人生观、价值观、道德修养、法治思维、宪法精神、权利义务等。
- `questions/politics-marxism.seed.json`：马克思主义基本原理 20 道原创题目。
- `questions/politics-maoism.seed.json`：毛泽东思想 20 道原创题目。
- `questions/politics-history.seed.json`：中国近现代史纲要 20 道原创题目。
- `questions/politics-morals.seed.json`：思想道德与法治 20 道原创题目。

政治小计：80 个知识节点，80 道题目。status=draft，来源为 WorkBuddy draft。

## 全库总计

- 数学：122 个知识节点 / 91 道题
- CS408：160 个知识节点 / 160 道题
- 物理：41 个知识节点 / 75 道题
- 英语：80 个知识节点 / 80 道题
- 政治：80 个知识节点 / 80 道题
- **总计：483 个知识节点 / 486 道题，29 个 Pack**
