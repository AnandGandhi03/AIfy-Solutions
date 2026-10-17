(function(){
  var b=document.getElementById('aify-menu-btn'),m=document.getElementById('aify-mobile-menu');
  if(b&&m){b.addEventListener('click',function(){var o=m.hasAttribute('hidden');if(o)m.removeAttribute('hidden');else m.setAttribute('hidden','');b.setAttribute('aria-expanded',o?'true':'false');});}
  var tabs=[].slice.call(document.querySelectorAll('[data-demo-tab]'));
  function pick(i){tabs.forEach(function(t){var on=t.getAttribute('data-demo-tab')===String(i);t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});
    [].forEach.call(document.querySelectorAll('[data-demo-panel]'),function(p){if(p.getAttribute('data-demo-panel')===String(i))p.removeAttribute('hidden');else p.setAttribute('hidden','');});}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){pick(i);});t.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){var n=(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;pick(n);tabs[n].focus();}});});
  if(tabs.length)pick(0);
  var f=document.querySelector('[data-aify-preview-form]');
  if(f){f.addEventListener('submit',function(e){e.preventDefault();var i=f.querySelector('[data-aify-preview-input]');var v=(i.value||'').trim();i.value='';if(window.AIfyAgent)window.AIfyAgent.open(v?{prompt:v}:{});});}
})();
