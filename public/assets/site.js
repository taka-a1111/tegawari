(function(){
  // メニュー（スマホ）
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('gnav');
  if (btn && nav) {
    btn.addEventListener('click', function(){
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.querySelector('span').textContent = open ? '閉じる' : 'メニュー';
    });
  }
  // お問い合わせフォーム
  var cf = document.querySelector('[data-contact-form]');
  if (cf) {
    var shown = Date.now();
    var kindQ = new URLSearchParams(location.search).get('kind');
    if (kindQ) { var ks = document.getElementById('c-kind'); for (var i = 0; i < ks.options.length; i++) if (ks.options[i].value === kindQ) ks.selectedIndex = i; }
    cf.addEventListener('submit', function(e){
      e.preventDefault();
      var m = cf.querySelector('.form-msg');
      var sb = cf.querySelector('button[type=submit]');
      var v = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
      var show = function(t, err){ m.textContent = t; m.classList.toggle('err', !!err); m.classList.add('show'); };
      if (!v('c-name') || !v('c-mail') || !v('c-body')) return show('お名前・メールアドレス・ご相談の内容を入力してください。', true);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('c-mail'))) return show('メールアドレスの形を確かめてください。', true);
      if (!document.getElementById('c-agree').checked) return show('プライバシーポリシーへの同意にチェックを入れてください。', true);
      sb.disabled = true;
      fetch('/api/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        company: v('c-company'), name: v('c-name'), email: v('c-mail'), tel: v('c-tel'),
        kind: v('c-kind'), message: v('c-body'), website: v('c-website'), elapsed: Date.now() - shown
      }) })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (j.ok) { show('送信しました。1〜2営業日以内に、ご入力のメールアドレスへお返事します。'); cf.reset(); }
          else show(j.message || '送信できませんでした。', true);
          sb.disabled = false;
        })
        .catch(function(){ show('通信がうまくいきませんでした。少し待ってからお試しください。', true); sb.disabled = false; });
    });
  }
  // 業務診断（画面の中だけで計算。入力内容はどこにも送らない）
  var f = document.getElementById('dx-form');
  if (!f) return;
  var TASKS = {
    inquiry: ['問い合わせへの一次返信', 3, 'よくある質問への返信の下書きをAIが作り、人が確認して送ります。'],
    estimate: ['見積書・請求書の作成', 3, '案件の情報から下書きを作り、会計ソフトへの入力まで自動にしやすい業務です。'],
    minutes: ['議事録・報告書のまとめ', 3, '録音やメモから要点をまとめる作業は、AIが最も得意な分野の一つです。'],
    article: ['ブログ・SNSの下書き', 2, '下書きはAIに任せやすい一方、事実の確認の手順を先に決める必要があります。'],
    sales: ['営業リスト作り・提案書の下書き', 2, '公開情報の収集と下書きは任せやすく、送る判断は人が持ちます。'],
    data: ['表計算への転記・集計', 3, '決まった形の転記や集計は、GASなどで自動にしやすい業務です。'],
    recruit: ['求人票・応募者への連絡', 2, '定型の連絡文は任せやすく、選考の判断は人が行います。'],
    schedule: ['日程調整・リマインド', 2, 'カレンダーとメールをつなぐと、手間を大きく減らせます。'],
    manual: ['社内マニュアル・手順書づくり', 2, '担当者の説明を文章に起こす作業は、AIで早く進められます。']
  };
  var shown = Date.now();
  var last = null;
  f.addEventListener('submit', function(e){
    e.preventDefault();
    var msg = document.getElementById('dx-msg');
    var rows = [];
    var ans = {};
    var missing = 0;
    Object.keys(TASKS).forEach(function(k){
      var t = f.querySelector('input[name="t_' + k + '"]:checked');
      var s = f.querySelector('input[name="s_' + k + '"]:checked');
      if (!t || !s) { missing++; return; }
      var time = Number(t.value), std = Number(s.value);
      ans[k] = { t: time, s: std };
      if (time === 0) return;
      rows.push({ k: k, score: time * std * TASKS[k][1], time: time, std: std });
    });
    if (missing) { msg.textContent = 'まだ答えていない質問があります（' + missing + '件）。'; msg.classList.add('show'); return; }
    msg.classList.remove('show');
    rows.sort(function(a, b){ return b.score - a.score; });
    var box = document.getElementById('dx-result');
    var ol = document.getElementById('dx-rank');
    ol.innerHTML = '';
    if (!rows.length) {
      var li0 = document.createElement('li'); li0.textContent = '今回の質問の中には、時間を使っている業務が見つかりませんでした。お問い合わせから、ほかの業務についてご相談ください。'; ol.appendChild(li0);
    }
    rows.slice(0, 3).forEach(function(r, i){
      var li = document.createElement('li');
      var b = document.createElement('b'); b.textContent = String(i + 1);
      var d = document.createElement('div');
      d.appendChild(document.createTextNode(TASKS[r.k][0]));
      var sm = document.createElement('small');
      var lv = r.score >= 12 ? '高' : r.score >= 6 ? '中' : '低';
      sm.textContent = '任せやすさ ' + lv + '・' + TASKS[r.k][2] + (r.std === 1 ? '（手順が人によって違うため、先に手順をそろえます）' : '');
      d.appendChild(sm); li.appendChild(b); li.appendChild(d); ol.appendChild(li);
    });
    box.classList.add('show');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    last = { answers: ans, industry: document.getElementById('dx-ind').value, size: document.getElementById('dx-size').value };
    if (mf) mf.hidden = false;
  });
  // 結果票をメールで受け取る
  var mf = document.getElementById('dx-mail');
  if (mf) mf.addEventListener('submit', function(e){
    e.preventDefault();
    var m = document.getElementById('m-msg');
    var sb = mf.querySelector('button[type=submit]');
    var v = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var show = function(t, err){ m.textContent = t; m.classList.toggle('err', !!err); m.classList.add('show'); };
    if (!last) return show('先に「結果を見る」を押してください。', true);
    if (!v('m-name') || !v('m-email')) return show('お名前とメールアドレスを入力してください。', true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('m-email'))) return show('メールアドレスの形を確かめてください。', true);
    if (!document.getElementById('m-agree').checked) return show('プライバシーポリシーへの同意にチェックを入れてください。', true);
    sb.disabled = true;
    fetch('/api/shindan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      company: v('m-company'), name: v('m-name'), email: v('m-email'), website: v('m-website'),
      consent: document.getElementById('m-consent').checked, agree: true, elapsed: Date.now() - shown,
      answers: last.answers, industry: last.industry, size: last.size
    }) })
      .then(function(r){ return r.json(); })
      .then(function(j){
        if (j.ok) { show('受け付けました。数分以内に、ご入力のメールアドレスへ結果票をお送りします。届かないときは、迷惑メールのフォルダもご確認ください。'); mf.reset(); }
        else { show(j.message || '送信できませんでした。', true); }
        sb.disabled = false;
      })
      .catch(function(){ show('通信がうまくいきませんでした。少し待ってからお試しください。', true); sb.disabled = false; });
  });
})();
