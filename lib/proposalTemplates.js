// lib/proposalTemplates.js — ミッション提案テンプレートプール
// カテゴリ: music / exhibit / sports / business / party / general
// タグ: 企画 / 運営 / 制作 / 広報
// フェーズ: early(開催3週間超前) / mid(1〜3週間前) / late(1週間前〜前日) / during(開催中) / after(終了後)
//   → 各テンプレの適合フェーズはファイル末尾の TEMPLATE_PHASES で定義（未定義は全フェーズ対象）
// {name} はプロジェクト名（最大8文字）に置換される

'use strict';

const TEMPLATES = [

  // ── music（ライブ・コンサート・フェス） ─────────────────────────────
  { id: 'mu-p1', title: '{name}のセットリストを決める',
    description: '演奏する曲順とセット内容を確定します。オープニングからラストまでのメリハリや時間配分を意識しましょう。',
    tag: '企画', format: 'text', categories: ['music'] },
  { id: 'mu-p2', title: '出演アーティスト・バンドを確定する',
    description: '出演者の確保と契約を行います。ヘッドライナーから決めて、全体の出演ラインナップを組み立てましょう。',
    tag: '企画', format: 'text', categories: ['music'] },
  { id: 'mu-p3', title: 'オープニング・エンディング演出を設計する',
    description: '会場の盛り上がりを作る演出を設計します。照明・映像・BGMなどの組み合わせを決めましょう。',
    tag: '企画', format: 'text', categories: ['music'] },
  { id: 'mu-o1', title: '機材の搬入・搬出スケジュールを組む',
    description: 'PA機材や楽器の輸送スケジュールを組みます。アーティストごとの機材リストをまとめておきましょう。',
    tag: '運営', format: 'text', categories: ['music'] },
  { id: 'mu-o2', title: 'リハーサルの進行管理表を作る',
    description: '各アーティストのサウンドチェック時間と順番を決めます。時間厳守のためバッファも確保しましょう。',
    tag: '運営', format: 'text', categories: ['music'] },
  { id: 'mu-o3', title: 'チケット販売・予約管理の仕組みを決める',
    description: '販売プラットフォームと枚数・種別を決めます。当日券の有無や早割の設定も検討しましょう。',
    tag: '運営', format: 'text', categories: ['music'] },
  { id: 'mu-c1', title: '{name}のフライヤー・ポスターをデザインする',
    description: '出演者情報と日時・会場を含むビジュアルを作成します。印刷用とSNS用でサイズを分けると便利です。',
    tag: '制作', format: 'image', categories: ['music'] },
  { id: 'mu-c2', title: 'グッズ・物販のラインアップを決める',
    description: 'Tシャツ・ステッカー・CDなど販売アイテムを決めます。製造に時間がかかるので早めに手配しましょう。',
    tag: '制作', format: 'text', categories: ['music'] },
  { id: 'mu-c3', title: 'ステージセット・装飾プランを作る',
    description: '背景・照明・装飾のビジュアルプランを作ります。アーティストのテイストに合わせた空間づくりが重要です。',
    tag: '制作', format: 'image', categories: ['music'] },
  { id: 'mu-pr1', title: 'チケット発売開始の告知を投稿する',
    description: '発売日時を事前に告知し、解禁と同時に拡散できるよう準備します。SNS・メルマガなど複数チャネルを活用しましょう。',
    tag: '広報', format: 'link', categories: ['music'] },
  { id: 'mu-pr2', title: '出演者紹介の記事・投稿を作る',
    description: 'アーティストの魅力を伝えるコンテンツを作ります。プロフィール・活動歴・コメントなどを盛り込みましょう。',
    tag: '広報', format: 'text', categories: ['music'] },
  { id: 'mu-pr3', title: '当日のSNSリアルタイム更新計画を立てる',
    description: '当日の様子を会場からライブ発信します。担当者と投稿ルールを事前に決めておきましょう。',
    tag: '広報', format: 'text', categories: ['music'] },

  // ── exhibit（展示・アート・ギャラリー） ──────────────────────────────
  { id: 'ex-p1', title: '展示テーマ・コンセプトを確定する',
    description: 'コンセプトを言語化します。キーワードやステートメントを決めることで、作品選定や展示デザインの軸になります。',
    tag: '企画', format: 'text', categories: ['exhibit'] },
  { id: 'ex-p2', title: '展示作品の選定・キュレーション計画を立てる',
    description: '展示する作品の選定基準と数を決めます。テーマとの一貫性と視覚的なバランスを意識しましょう。',
    tag: '企画', format: 'text', categories: ['exhibit'] },
  { id: 'ex-p3', title: '観覧動線・フロアレイアウトを設計する',
    description: '来場者が自然に回れるフロア配置を設計します。メイン作品への導線と休憩スペースも計画しましょう。',
    tag: '企画', format: 'image', categories: ['exhibit'] },
  { id: 'ex-o1', title: '会場設営・撤収のスケジュールを組む',
    description: '作品の展示位置決めから完成までのスケジュールを組みます。搬入・撤収の業者手配も含めて管理しましょう。',
    tag: '運営', format: 'text', categories: ['exhibit'] },
  { id: 'ex-o2', title: '受付・誘導スタッフの配置を決める',
    description: '入場管理と会場内案内のスタッフ配置を決めます。混雑時の対応フローも事前に決めておきましょう。',
    tag: '運営', format: 'text', categories: ['exhibit'] },
  { id: 'ex-o3', title: '作品の搬入・梱包手順書を作る',
    description: '作品の梱包・輸送・設置の手順書を作ります。デリケートな作品は専門業者の利用も検討しましょう。',
    tag: '運営', format: 'text', categories: ['exhibit'] },
  { id: 'ex-c1', title: '解説パネル・キャプションを制作する',
    description: '作品タイトル・作家名・制作年・解説文を制作します。読みやすいフォントサイズとレイアウトを意識しましょう。',
    tag: '制作', format: 'text', categories: ['exhibit'] },
  { id: 'ex-c2', title: '図録・パンフレットをデザインする',
    description: '展示内容をまとめた印刷物を作ります。持ち帰れる記念品としても機能するので丁寧に制作しましょう。',
    tag: '制作', format: 'image', categories: ['exhibit'] },
  { id: 'ex-c3', title: '映像・インタラクティブ演出プランを作る',
    description: 'プロジェクションや体験型コンテンツの企画と技術要件を整理します。機材の調達と設置スペースも確認しましょう。',
    tag: '制作', format: 'text', categories: ['exhibit'] },
  { id: 'ex-pr1', title: 'プレス向け内覧会の招待状を送る',
    description: '開幕前にメディア・関係者向けの内覧会を設けます。プレスリリースとともに招待状を送りましょう。',
    tag: '広報', format: 'text', categories: ['exhibit'] },
  { id: 'ex-pr2', title: 'SNSで作品プレビューを投稿する',
    description: '展示前に作品の一部を公開して期待感を高めます。ティザー投稿で来場意欲を引き出しましょう。',
    tag: '広報', format: 'image', categories: ['exhibit'] },
  { id: 'ex-pr3', title: '来場者向けノベルティ・記念品を準備する',
    description: 'ポストカード・ステッカーなど持ち帰れる記念品を用意します。SNS投稿を促すアイテムも効果的です。',
    tag: '広報', format: 'text', categories: ['exhibit'] },

  // ── sports（スポーツ・大会・競技） ───────────────────────────────────
  { id: 'sp-p1', title: '競技ルール・レギュレーションを策定する',
    description: '競技の基本ルールと特別規定を文書化します。参加者全員が事前に確認できるよう配布しましょう。',
    tag: '企画', format: 'text', categories: ['sports'] },
  { id: 'sp-p2', title: '参加資格・エントリー条件を決める',
    description: '年齢・技術レベル・所属などの参加条件を決め、エントリーフォームを準備します。',
    tag: '企画', format: 'text', categories: ['sports'] },
  { id: 'sp-p3', title: '賞品・賞金・表彰内容を設計する',
    description: '優勝から上位入賞までの賞品・賞状を決めます。参加者のモチベーションになるような内容にしましょう。',
    tag: '企画', format: 'text', categories: ['sports'] },
  { id: 'sp-o1', title: '審判・スコアラーのスタッフを確保する',
    description: '公正な進行のための審判員を確保します。試合数と同時進行の会場数から必要人数を算出しましょう。',
    tag: '運営', format: 'text', categories: ['sports'] },
  { id: 'sp-o2', title: '競技進行のタイムテーブルを作る',
    description: '試合開始から表彰式まで時間割を作ります。遅延に備えたバッファ時間も必ず設けましょう。',
    tag: '運営', format: 'text', categories: ['sports'] },
  { id: 'sp-o3', title: '救護・緊急対応マニュアルを整備する',
    description: '医療スタッフの配置と緊急時の対応フローを整備します。AEDの場所確認と熱中症対策も忘れずに。',
    tag: '運営', format: 'text', categories: ['sports'] },
  { id: 'sp-c1', title: '記録用スコアシート・記録用紙を作る',
    description: '試合結果・記録を正確に残すための用紙を作ります。電子化すれば集計も楽になります。',
    tag: '制作', format: 'text', categories: ['sports'] },
  { id: 'sp-c2', title: 'トーナメント表・組み合わせ表を作る',
    description: '組み合わせ抽選を行い、対戦表を作成します。見やすい形式で会場掲示用と配布用を用意しましょう。',
    tag: '制作', format: 'image', categories: ['sports'] },
  { id: 'sp-c3', title: '表彰状・メダル・トロフィーを手配する',
    description: '授賞式で使用する記念品を手配します。印刷・製造に時間がかかるので早めに発注しましょう。',
    tag: '制作', format: 'text', categories: ['sports'] },
  { id: 'sp-pr1', title: '参加募集ページとエントリーフォームを作る',
    description: '参加者が申し込めるフォームを作り、募集要項とともに公開します。締切・定員を明記しましょう。',
    tag: '広報', format: 'link', categories: ['sports'] },
  { id: 'sp-pr2', title: '試合結果・速報をSNSで発信する',
    description: '試合終了後すぐにSNSで結果を発信します。ハイライト写真や注目の場面コメントも添えると反響が増します。',
    tag: '広報', format: 'text', categories: ['sports'] },
  { id: 'sp-pr3', title: 'ハイライト動画・フォトレポートを制作する',
    description: '当日の熱戦を写真・動画で記録し、開催後に公開します。出場者への共有も忘れずに。',
    tag: '広報', format: 'image', categories: ['sports'] },

  // ── business（カンファレンス・セミナー・勉強会） ─────────────────────
  { id: 'biz-p1', title: 'セッション構成・プログラムを設計する',
    description: '講演・パネルディスカッション・QAの流れと時間配分を設計します。参加者が得る学びのストーリーを意識しましょう。',
    tag: '企画', format: 'text', categories: ['business'] },
  { id: 'biz-p2', title: '登壇者・スピーカーを選定する',
    description: 'テーマに合った専門性を持つ登壇者を選定します。早期に依頼して予定を確保することが重要です。',
    tag: '企画', format: 'text', categories: ['business'] },
  { id: 'biz-p3', title: 'ワークショップ・グループワークを設計する',
    description: '参加者が主体的に動けるグループワークを設計します。アウトプットの形式と共有方法まで決めておきましょう。',
    tag: '企画', format: 'text', categories: ['business'] },
  { id: 'biz-o1', title: '会場レイアウト・席次を設計する',
    description: 'スクリーン・ステージ・座席の配置を設計します。参加人数と会場の制約を確認して最適なレイアウトにしましょう。',
    tag: '運営', format: 'image', categories: ['business'] },
  { id: 'biz-o2', title: '受付・名札・事前資料を準備する',
    description: '当日の受付フローと事前資料の準備をします。名刺交換がしやすい動線も考慮しましょう。',
    tag: '運営', format: 'text', categories: ['business'] },
  { id: 'biz-o3', title: '懇親会・ネットワーキングセッションを設計する',
    description: '登壇者と参加者が交流できる場を設計します。会話のきっかけとなるアイスブレイクも準備しましょう。',
    tag: '運営', format: 'text', categories: ['business'] },
  { id: 'biz-c1', title: 'スライドテンプレートのデザインを統一する',
    description: '登壇者全員が使えるデザイン統一のテンプレートを作ります。ロゴ・カラー・フォントを揃えてブランド感を出しましょう。',
    tag: '制作', format: 'image', categories: ['business'] },
  { id: 'biz-c2', title: '配布資料・ハンドアウトを作成する',
    description: '参加者が後から見返せる資料を用意します。当日配布か事後送付かも決めておきましょう。',
    tag: '制作', format: 'text', categories: ['business'] },
  { id: 'biz-c3', title: '配信・録画環境を構築する',
    description: 'オンライン参加者向けの配信環境と録画設定を整えます。接続テストと配信プラットフォームの準備を事前に行いましょう。',
    tag: '制作', format: 'link', categories: ['business'] },
  { id: 'biz-pr1', title: '参加者向け告知・集客施策を実施する',
    description: 'イベント告知ページを作り、ターゲットに届く告知を行います。参加特典や登壇者情報が集客の鍵です。',
    tag: '広報', format: 'link', categories: ['business'] },
  { id: 'biz-pr2', title: '登壇者プロフィール紹介記事を作る',
    description: '登壇者のプロフィールと見どころを紹介するコンテンツを作ります。参加意欲を高める魅力的な紹介文を書きましょう。',
    tag: '広報', format: 'text', categories: ['business'] },
  { id: 'biz-pr3', title: '開催後レポート・まとめ記事を作る',
    description: '当日の学びや登壇内容をまとめた記事を公開します。参加者への御礼と次回開催への布石にもなります。',
    tag: '広報', format: 'text', categories: ['business'] },

  // ── party（パーティー・懇親会・お祝い） ──────────────────────────────
  { id: 'pa-p1', title: 'パーティーのテーマとドレスコードを決める',
    description: 'パーティーの世界観を決めます。テーマに合ったドレスコードを設定すると参加者の一体感が生まれます。',
    tag: '企画', format: 'text', categories: ['party'] },
  { id: 'pa-p2', title: '余興・ゲームのプログラムを企画する',
    description: '参加者が楽しめる余興やゲームを計画します。全員参加型のコンテンツで会場を盛り上げましょう。',
    tag: '企画', format: 'text', categories: ['party'] },
  { id: 'pa-p3', title: '食事・ドリンクのメニューを選定する',
    description: 'ケータリングやコース料理を決めます。アレルギー対応や会費とのバランスも検討しましょう。',
    tag: '企画', format: 'text', categories: ['party'] },
  { id: 'pa-o1', title: '参加者名簿・席次表を管理する',
    description: '参加者リストを管理し、座席配置を決めます。グループごとのバランスを考えた席次にしましょう。',
    tag: '運営', format: 'text', categories: ['party'] },
  { id: 'pa-o2', title: '司会進行の台本を作成する',
    description: '開始から終了までの流れと司会コメントを台本にします。乾杯・余興・締めの言葉まで決めておきましょう。',
    tag: '運営', format: 'text', categories: ['party'] },
  { id: 'pa-o3', title: '当日スタッフの役割分担を決める',
    description: '受付・料理管理・撮影などの役割を決めます。当日に慌てないよう事前に全員で確認しましょう。',
    tag: '運営', format: 'text', categories: ['party'] },
  { id: 'pa-c1', title: '会場デコレーション・装飾を制作する',
    description: 'テーマに合った装飾を制作・手配します。バルーン・フラワー・バナーなど雰囲気を演出するアイテムを揃えましょう。',
    tag: '制作', format: 'image', categories: ['party'] },
  { id: 'pa-c2', title: '招待状・案内状をデザインする',
    description: '参加者への案内を作成します。日時・場所・ドレスコード・返信期限を明確に記載しましょう。',
    tag: '制作', format: 'image', categories: ['party'] },
  { id: 'pa-c3', title: '記念品・プレゼントを手配する',
    description: '参加者への引き出物や記念品を手配します。みんなが喜ぶアイテムを予算内で選びましょう。',
    tag: '制作', format: 'text', categories: ['party'] },
  { id: 'pa-pr1', title: '参加申込フォームを作成・公開する',
    description: '出欠確認ができるフォームを作成します。食事制限や質問事項も一緒に聞いておくと便利です。',
    tag: '広報', format: 'link', categories: ['party'] },
  { id: 'pa-pr2', title: '招待メール・メッセージを配信する',
    description: '参加者への正式招待を送ります。日程・場所・準備物などを漏れなく記載しましょう。',
    tag: '広報', format: 'text', categories: ['party'] },
  { id: 'pa-pr3', title: '当日の写真・動画記録プランを立てる',
    description: '当日の思い出を残す撮影計画を立てます。フォトブースや集合写真のタイミングも決めておきましょう。',
    tag: '広報', format: 'image', categories: ['party'] },

  // ── general（汎用・全カテゴリで使用可） ────────────────────────────
  { id: 'ge-p1', title: '開催場所・会場を決める',
    description: 'イベントをどこで行うか決めます。オンライン・対面・ハイブリッドの形式も含めて検討しましょう。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-p2', title: '数値目標（KPI）を設定する',
    description: '成功を測る指標を設定します。来場者数・参加率・満足度など具体的な数値で管理しましょう。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-p3', title: '全体スケジュール・マイルストーンを作る',
    description: '全体のタスクを洗い出し、期限を設定します。逆算して余裕のあるスケジュールを作りましょう。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-p4', title: '予算計画・費用見積もりを作成する',
    description: '会場費・制作費・広報費などを項目別に見積もります。収支のバランスを確認して進めましょう。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-p5', title: 'リスク・トラブル対策プランを立てる',
    description: '想定されるリスクを列挙し、対策を事前に決めます。当日のトラブルに慌てないよう準備しましょう。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-p6', title: '参加者ターゲット・ペルソナを定義する',
    description: '参加者像を具体化します。誰に来てほしいかを明確にすることで、企画・広報の方針が定まります。',
    tag: '企画', format: 'text', categories: ['general'] },
  { id: 'ge-o1', title: '当日のタイムスケジュールを作成する',
    description: '当日の流れを時間単位で書き出します。開場・開始・休憩・終了など各フェーズのタイミングを決めましょう。',
    tag: '運営', format: 'text', categories: ['general'] },
  { id: 'ge-o2', title: 'スタッフ・ボランティアを募集する',
    description: '必要な人数と役割を決め、協力者を募ります。事前に役割説明と練習の機会を作りましょう。',
    tag: '運営', format: 'text', categories: ['general'] },
  { id: 'ge-o3', title: '備品・消耗品リストを作成する',
    description: '当日必要な物品をリストアップします。購入品・レンタル品・持参品に分けて管理しましょう。',
    tag: '運営', format: 'text', categories: ['general'] },
  { id: 'ge-o4', title: '会場・施設との連絡・折衝を行う',
    description: '会場の利用ルールや設備の確認を行います。搬入時間・退場時間・禁止事項を事前に確認しましょう。',
    tag: '運営', format: 'text', categories: ['general'] },
  { id: 'ge-o5', title: '緊急連絡網・対応マニュアルを整備する',
    description: '当日のトラブル時に動けるよう連絡先と対応手順を整理します。全スタッフに共有しましょう。',
    tag: '運営', format: 'text', categories: ['general'] },
  { id: 'ge-o6', title: 'アンケート・フィードバックを設計する',
    description: '参加者の満足度を測るアンケートを設計します。次回の改善に活かせる質問を入れましょう。',
    tag: '運営', format: 'link', categories: ['general'] },
  { id: 'ge-c1', title: 'メインビジュアルを作成する',
    description: 'イベントの顔となる画像を作成します。テーマカラーやロゴを含めると統一感が出て効果的です。',
    tag: '制作', format: 'image', categories: ['general'] },
  { id: 'ge-c2', title: 'ウェブサイト・ランディングページを作る',
    description: 'イベント情報をまとめた告知ページを作ります。アクセス・日程・内容・申込方法を分かりやすく記載しましょう。',
    tag: '制作', format: 'link', categories: ['general'] },
  { id: 'ge-c3', title: '必要な機材・備品リストを作成する',
    description: 'イベント運営に必要な機材をリスト化します。持参・レンタル・購入の区別も記載しておきましょう。',
    tag: '制作', format: 'text', categories: ['general'] },
  { id: 'ge-c4', title: '記録・アーカイブの方針を決める',
    description: '当日の記録方法と公開範囲を決めます。写真・動画・ブログなど媒体ごとのルールを定めましょう。',
    tag: '制作', format: 'text', categories: ['general'] },
  { id: 'ge-c5', title: '配布物のデザイン・印刷手配をする',
    description: 'チラシ・パンフレットなどの印刷物を作ります。発注から納品まで時間がかかるので早めに動きましょう。',
    tag: '制作', format: 'image', categories: ['general'] },
  { id: 'ge-c6', title: '写真・動画の撮影プランを立てる',
    description: '当日の記録を担当者に依頼し、撮影ポイントを決めます。プロカメラマンへの依頼も検討しましょう。',
    tag: '制作', format: 'image', categories: ['general'] },
  { id: 'ge-pr1', title: 'SNSハッシュタグを決定する',
    description: '参加者が使える統一タグを決めます。イベント名を含めたシンプルなタグにすると拡散されやすいです。',
    tag: '広報', format: 'text', categories: ['general'] },
  { id: 'ge-pr2', title: '広報スケジュール・SNS投稿計画を作る',
    description: '告知開始から当日まで、SNS投稿の計画を立てます。発信頻度と内容を事前に決めておきましょう。',
    tag: '広報', format: 'text', categories: ['general'] },
  { id: 'ge-pr3', title: '公式SNSアカウントを準備する',
    description: 'イベント専用またはブランドの公式アカウントを準備します。プロフィール・固定投稿も整えましょう。',
    tag: '広報', format: 'link', categories: ['general'] },
  { id: 'ge-pr4', title: 'メディア・プレス対応の窓口を設置する',
    description: '取材依頼の窓口となるプレスキットを用意します。基本情報・画像素材・担当者連絡先をまとめましょう。',
    tag: '広報', format: 'text', categories: ['general'] },
  { id: 'ge-pr5', title: '事前告知キャンペーンを設計する',
    description: '開催前に話題を作る施策を設計します。カウントダウンや参加者インタビューなどで期待感を高めましょう。',
    tag: '広報', format: 'text', categories: ['general'] },
  { id: 'ge-pr6', title: '開催後の振り返り投稿・レポートを作る',
    description: 'イベント終了後に感謝とハイライトをまとめた投稿を作ります。次回への布石にもなります。',
    tag: '広報', format: 'text', categories: ['general'] },

  // ── spark（気づき・調査・情報収集の軽量タスク。序盤フェーズで1枠だけ提案される） ──
  // kind:'spark' は proposalEngine 側でのみ参照する内部マーカー（永続化される提案フィールドには含まれない）。
  // 成果物ではなく「手を動かす前の小さな一歩」を促す。採用されにくい前提で大粒提案と混ぜて出す。
  { id: 'sk-pr1', title: '{name}を広報できるWEB・SNSサービスを調べる',
    description: '告知に使えそうな媒体やサービスを洗い出して比較します。掲載条件・費用・リーチを軽くメモしておくと後で効きます。',
    tag: '広報', format: 'link', categories: ['general'], kind: 'spark' },
  { id: 'sk-pr2', title: '同時期に開催される似たイベントをチェックする',
    description: '日程やターゲットが近いイベントを調べます。被りや差別化のヒント、参考になる打ち出し方が見つかります。',
    tag: '広報', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-pr3', title: '参考になるSNS発信・アカウントを集めてみる',
    description: '真似したい投稿や運用が上手いアカウントをいくつかブックマークします。自分たちの発信の方向性が掴めます。',
    tag: '広報', format: 'link', categories: ['general'], kind: 'spark' },
  { id: 'sk-p1', title: '似たイベントの成功・失敗事例をリサーチする',
    description: '過去の類似イベントから良かった点・つまずいた点を調べます。企画の地雷を先に避けられます。',
    tag: '企画', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-p2', title: '来てほしい人が今どんなことを求めているか調べる',
    description: 'ターゲット層の関心や悩みを軽くヒアリング・検索します。企画の刺さりどころが見えてきます。',
    tag: '企画', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-p3', title: '予算・費用の相場をざっくり調べておく',
    description: '会場費・印刷費・機材費などの相場感を先に掴みます。後の予算計画がブレにくくなります。',
    tag: '企画', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-p4', title: 'イベントで使えそうなネタ・アイデアを集める',
    description: '気になる演出や企画の引き出しを増やします。ボツでもいいので数を出してストックしておきましょう。',
    tag: '企画', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-o1', title: '使えそうな運営ツール・アプリを比較してみる',
    description: '受付・連絡・スケジュール管理などに使えるツールを調べます。早めに決めると当日の段取りが楽になります。',
    tag: '運営', format: 'link', categories: ['general'], kind: 'spark' },
  { id: 'sk-o2', title: '協賛・協力をお願いできそうな相手を洗い出す',
    description: '声をかけられそうな企業・団体・個人をリストにします。早く動くほど交渉の余地が生まれます。',
    tag: '運営', format: 'text', categories: ['general'], kind: 'spark' },
  { id: 'sk-o3', title: '会場やスペースの候補をいくつか挙げて比べる',
    description: '候補地を複数ピックアップして広さ・アクセス・費用を比較します。仮押さえの締切も確認しておきましょう。',
    tag: '運営', format: 'text', categories: ['general'], kind: 'spark' },
];

// ── 各テンプレートの適合フェーズ ──────────────────────────────
// proposalEngine.detectPhase の出力（early/mid/late/during/after）に対応。
// ここに無い id は「全フェーズ対象」として中立スコアで扱われる。
const TEMPLATE_PHASES = {
  // music
  'mu-p1':  ['early', 'mid'],   // セットリスト
  'mu-p2':  ['early'],          // 出演者確定
  'mu-p3':  ['early', 'mid'],   // 演出設計
  'mu-o1':  ['mid', 'late'],    // 搬入出スケジュール
  'mu-o2':  ['late'],           // リハ進行管理
  'mu-o3':  ['early', 'mid'],   // チケット販売の仕組み
  'mu-c1':  ['early', 'mid'],   // フライヤー
  'mu-c2':  ['early', 'mid'],   // グッズ
  'mu-c3':  ['mid'],            // ステージセット
  'mu-pr1': ['mid'],            // チケット発売告知
  'mu-pr2': ['mid', 'late'],    // 出演者紹介
  'mu-pr3': ['late', 'during'], // 当日SNS計画
  // exhibit
  'ex-p1':  ['early'],          // テーマ確定
  'ex-p2':  ['early'],          // キュレーション
  'ex-p3':  ['early', 'mid'],   // 動線レイアウト
  'ex-o1':  ['mid', 'late'],    // 設営撤収スケジュール
  'ex-o2':  ['late'],           // 受付誘導配置
  'ex-o3':  ['mid', 'late'],    // 搬入梱包手順
  'ex-c1':  ['mid'],            // キャプション
  'ex-c2':  ['mid'],            // 図録
  'ex-c3':  ['early', 'mid'],   // 映像演出
  'ex-pr1': ['mid', 'late'],    // プレス内覧会
  'ex-pr2': ['mid', 'late'],    // SNSプレビュー
  'ex-pr3': ['mid'],            // ノベルティ
  // sports
  'sp-p1':  ['early'],          // ルール策定
  'sp-p2':  ['early'],          // 参加資格
  'sp-p3':  ['early', 'mid'],   // 賞品設計
  'sp-o1':  ['mid'],            // 審判確保
  'sp-o2':  ['mid', 'late'],    // タイムテーブル
  'sp-o3':  ['mid', 'late'],    // 救護マニュアル
  'sp-c1':  ['mid', 'late'],    // スコアシート
  'sp-c2':  ['late'],           // トーナメント表
  'sp-c3':  ['mid'],            // 表彰状手配
  'sp-pr1': ['early', 'mid'],   // 募集ページ
  'sp-pr2': ['during'],         // 結果速報
  'sp-pr3': ['during', 'after'],// ハイライト動画
  // business
  'biz-p1':  ['early'],          // プログラム設計
  'biz-p2':  ['early'],          // 登壇者選定
  'biz-p3':  ['early', 'mid'],   // ワークショップ設計
  'biz-o1':  ['mid'],            // 会場レイアウト
  'biz-o2':  ['late'],           // 受付名札資料
  'biz-o3':  ['mid'],            // 懇親会設計
  'biz-c1':  ['early', 'mid'],   // スライドテンプレ
  'biz-c2':  ['mid', 'late'],    // 配布資料
  'biz-c3':  ['mid', 'late'],    // 配信環境
  'biz-pr1': ['early', 'mid'],   // 集客施策
  'biz-pr2': ['mid', 'late'],    // 登壇者紹介
  'biz-pr3': ['after'],          // 開催後レポート
  // party
  'pa-p1':  ['early'],           // テーマ・ドレスコード
  'pa-p2':  ['early', 'mid'],    // 余興企画
  'pa-p3':  ['early', 'mid'],    // メニュー選定
  'pa-o1':  ['mid', 'late'],     // 名簿席次
  'pa-o2':  ['late'],            // 司会台本
  'pa-o3':  ['late'],            // 役割分担
  'pa-c1':  ['mid'],             // 装飾制作
  'pa-c2':  ['early', 'mid'],    // 招待状
  'pa-c3':  ['mid'],             // 記念品
  'pa-pr1': ['early', 'mid'],    // 申込フォーム
  'pa-pr2': ['mid'],             // 招待メール
  'pa-pr3': ['late', 'during'],  // 撮影プラン
  // general
  'ge-p1':  ['early'],           // 会場決め
  'ge-p2':  ['early'],           // KPI
  'ge-p3':  ['early'],           // マイルストーン
  'ge-p4':  ['early'],           // 予算
  'ge-p5':  ['early', 'mid'],    // リスク対策
  'ge-p6':  ['early'],           // ペルソナ
  'ge-o1':  ['late'],            // 当日タイムスケジュール
  'ge-o2':  ['early', 'mid'],    // スタッフ募集
  'ge-o3':  ['mid', 'late'],     // 備品リスト
  'ge-o4':  ['mid'],             // 会場折衝
  'ge-o5':  ['late'],            // 緊急連絡網
  'ge-o6':  ['mid', 'late'],     // アンケート設計
  'ge-c1':  ['early', 'mid'],    // メインビジュアル
  'ge-c2':  ['early', 'mid'],    // LP
  'ge-c3':  ['mid'],             // 機材リスト
  'ge-c4':  ['mid'],             // アーカイブ方針
  'ge-c5':  ['mid', 'late'],     // 配布物印刷
  'ge-c6':  ['late'],            // 撮影プラン
  'ge-pr1': ['early', 'mid'],    // ハッシュタグ
  'ge-pr2': ['early', 'mid'],    // 投稿計画
  'ge-pr3': ['early'],           // 公式アカウント
  'ge-pr4': ['mid'],             // プレス窓口
  'ge-pr5': ['mid', 'late'],     // 事前告知キャンペーン
  'ge-pr6': ['after'],           // 振り返り投稿
  // spark（気づき・調査）: 序盤フェーズ向け。reserveSpark で early/mid のとき1枠確保される
  'sk-pr1': ['early', 'mid'],    // 広報サービス調査
  'sk-pr2': ['early', 'mid'],    // 類似イベントチェック
  'sk-pr3': ['early', 'mid'],    // 参考SNS収集
  'sk-p1':  ['early', 'mid'],    // 成功失敗事例リサーチ
  'sk-p2':  ['early', 'mid'],    // ターゲットニーズ調査
  'sk-p3':  ['early', 'mid'],    // 予算相場調査
  'sk-p4':  ['early', 'mid'],    // ネタ収集
  'sk-o1':  ['early', 'mid'],    // 運営ツール比較
  'sk-o2':  ['early', 'mid'],    // 協賛先洗い出し
  'sk-o3':  ['early', 'mid'],    // 会場候補比較
};

for (const t of TEMPLATES) {
  if (TEMPLATE_PHASES[t.id]) t.phases = TEMPLATE_PHASES[t.id];
}

module.exports = { TEMPLATES };
