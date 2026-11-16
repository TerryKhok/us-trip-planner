/* ライブ共有の設定。
   supabaseUrl と supabaseAnonKey が空のあいだは、ライブ共有は使われず、今までどおりこの端末だけで動きます。
   入れるのは「Project URL」と「anon public」キーだけ。service_role キーは絶対に入れないでください。
   (anon キーは公開されても安全です: データベースは、秘密のリンクを知っている人の関数経由でしか読み書きできません) */
window.TP_CONFIG = {
  supabaseUrl: 'https://orfzoskitytelqfjqvaa.supabase.co',
  supabaseAnonKey: 'sb_publishable_WTzEnMcSTUaVgq65MI2hBQ_2InhYDhm',
};

/* 通信先を、設定したURLだけにしぼる(index.html の許可リストに、さらに条件を足す) */
(function () {
  var cfg = window.TP_CONFIG;
  if (!cfg || !cfg.supabaseUrl) return;
  try {
    var origin = new URL(cfg.supabaseUrl).origin;
    var m = document.createElement('meta');
    m.httpEquiv = 'Content-Security-Policy';
    m.content = "default-src 'self' file:; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'self' " + origin;
    document.head.appendChild(m);
  } catch (e) { /* URLが正しくなければ何もしない */ }
})();
