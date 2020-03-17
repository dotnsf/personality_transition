# personality_transition


## Overview

Tweet の内容から自分の性格の移り変わりの様子を視覚化するサービス


## 動作の仕組み

1. OAuth2 認可によるログインを行う

2. ログインユーザーの権限で自分自身の直近 **200** ツイートを取得する

3. 取得した 200 ツイートを 40 ツイートずつ **5** つのブロックに分ける

4. 各ブロックの内容ごとに IBM Watson Personality Insights API を使って性格分析にかける（これを５ブロックぶん繰り返す）

5. 各ブロックごとの分析結果をスライダーの移動で切り替わるように視覚化する


## IBM Watson Personality Insights

- IBM Watson Personality Insights

  - https://www.ibm.com/watson/jp-ja/developercloud/personality-insights.html

- 開発者向け情報

  - https://cloud.ibm.com/docs/services/personality-insights?topic=personality-insights-agreeableness

## Licensing

This code is licensed under MIT.


## Copyright

2020  [K.Kimura @ Juge.Me](https://github.com/dotnsf) all rights reserved.
