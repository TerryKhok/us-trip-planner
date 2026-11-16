/* ライブ共有の設定。
   supabaseUrl と supabaseAnonKey が空のあいだは、ライブ共有は使われず、今までどおりこの端末だけで動きます。
   入れるのは「Project URL」と「公開用(publishable / anon public)」キーだけ。URL を変えるときは、index.html の connect-src にも同じURLを書くこと(通信できる先をそのURLだけにしてあるため)。service_role キーは絶対に入れないでください。
   (anon キーは公開されても安全です: データベースは、秘密のリンクを知っている人の関数経由でしか読み書きできません) */
window.TP_CONFIG = {
  supabaseUrl: 'https://orfzoskitytelqfjqvaa.supabase.co',
  supabaseAnonKey: 'sb_publishable_WTzEnMcSTUaVgq65MI2hBQ_2InhYDhm',
};
