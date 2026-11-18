# 音游延迟调整器 Rhythm Game Delay Modifier

## ⚠ AI声明 AI Declaration
此项目大部分代码为AI生成，仅进行了极小部分的人工修改，无法确认网页安全性

This project uses vibe coding as the main way to write program, with just a little modification done by human. Hence, there may have security risks.

## 关于这个作品 About

这个作品可以通过在音游结算中的Fast/Late数量来判断你需要怎么样调你的判定/音频延迟

## 版本 Version

### Version BETA-0.0.1
2026-11-18

初版，对比AI的vibe coding版增加了对少量音游的支持

First edition. Just add a few rhythm game support.

## 测试 Test Cases

### 1. Muse Dash (电脑端/PC)

#### 分别以不同延迟游玩了高手难度的《Baqeela》

#### Used different delay to play the second difficulty of "Baqeela"

结果如下 Results:
![0](testcase/v.0.0.1_beta/test1/play1.png)
![0.01](testcase/v.0.0.1_beta/test1/play2.png)
![-0.01](testcase/v.0.0.1_beta/test1/play3.png)
![-0.003](testcase/v.0.0.1_beta/test1/play4.png)
![0.002](testcase/v.0.0.1_beta/test1/play5.png)

![data](testcase/v.0.0.1_beta/test1/data1.png)
根据上面的数据，我们拟合出了一条曲线，并且预测其最高峰在于设置延迟为0.001.
![graph](testcase/v.0.0.1_beta/test1/data2.png)

之后按照延迟0.001进行游戏，结果如下:
![0.001](testcase/v.0.0.1_beta/test1/play6.png)

可以发现PERFECT数是在这六组游戏数据里面最高(609)

## 原理 How does it work?

略，我也在研究.jpg

I don't know
