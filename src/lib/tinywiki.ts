// Pure helpers for building, parsing, and validating self-contained
// TinyWiki / TiddlyWiki HTML documents used by the Procedures pane.
// No storage I/O — persistence happens via server functions.

const MAX_NAME_LEN = 120;
const DISALLOWED_CHARS = /[\/\\<>:"|?*\x00-\x1f]/;

export function validateWikiName(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) throw new Error("Name is required.");
  if (cleaned.length > MAX_NAME_LEN) throw new Error(`Name must be ${MAX_NAME_LEN} characters or fewer.`);
  if (DISALLOWED_CHARS.test(cleaned)) throw new Error('Name cannot contain: / \\ < > : " | ? * or control characters.');
  if (cleaned.startsWith(".") || cleaned.endsWith(".")) throw new Error("Name cannot start or end with a dot.");
  return cleaned;
}

function escAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escPre(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function tiddlyTimestamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}${p(d.getUTCMilliseconds(), 3)}`;
}

export function isTinyWikiHtml(s: string): boolean {
  return /<div\s+id=["']storeArea["']/i.test(s);
}

/** Build a complete TinyWiki HTML document with `body` as the main tiddler. */
export function buildTinyWikiHtml(name: string, body: string): string {
  const ts = tiddlyTimestamp();
  const titleAttr = escAttr(name);
  const safeBody = escPre(body);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="application-name" content="TiddlyWiki" />
<meta name="generator" content="TiddlyWiki" />
<meta name="tiddlywiki-version" content="5.1.23" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escAttr(name)} — Procedure</title>
<style>.tc-error-form{font-family:sans-serif}</style>
</head>
<body class="tc-body">
<div id="storeArea" style="display:none;">
<div title="$:/SiteTitle"><pre>${escPre(name)}</pre></div>
<div created="${ts}" list="${titleAttr}" modified="${ts}" title="$:/StoryList"><pre></pre></div>
<div created="${ts}" modified="${ts}" tags="" title="${titleAttr}">
<pre>${safeBody}</pre>
</div>
<div title="$:/isEncrypted"><pre>no</pre></div>
</div><!-- end storeArea -->
<script>
(function(){
  var store=document.getElementById('storeArea');if(!store)return;
  var tiddlers={};var divs=store.getElementsByTagName('div');
  for(var i=0;i<divs.length;i++){var d=divs[i];var t=d.getAttribute('title');if(!t)continue;
    var pre=d.getElementsByTagName('pre')[0];
    tiddlers[t]={title:t,text:pre?pre.textContent:'',tags:d.getAttribute('tags')||'',type:d.getAttribute('type')||'text/vnd.tiddlywiki'};
  }
  function wikiToHtml(text){
    function slug(s){return String(s).toLowerCase().replace(/&[a-z]+;/g,' ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);}
    var html=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^!!! (.*$)/gim,function(m,s){return '<h3 id="'+slug(s)+'">'+s+'</h3>';})
      .replace(/^!! (.*$)/gim,function(m,s){return '<h2 id="'+slug(s)+'">'+s+'</h2>';})
      .replace(/^! (.*$)/gim,function(m,s){return '<h1 id="'+slug(s)+'">'+s+'</h1>';})
      .replace(/^----$/gim,'<hr>')
      .replace(/''(.*?)''/g,'<strong>$1</strong>')
      .replace(/\\/\\/(.*?)\\/\\//g,'<em>$1</em>')
      .replace(/\\[\\[([^\\]|]+)\\|([^\\]]+)\\]\\]/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\\[\\[([^\\]]+)\\]\\]/g,'<a href="#" data-tiddler="$1">$1</a>')
      .replace(/\\[img\\[([^\\]]+)\\]\\]/g,function(m,fn){var it=tiddlers[fn];if(it&&it.type&&it.type.indexOf('image/')===0)return '<img src="data:'+it.type+';base64,'+it.text.trim()+'" alt="'+fn+'" style="max-width:100%">';return '<span>[img['+fn+']]</span>';})
      .replace(/&lt;&lt;&lt;\\n([\\s\\S]*?)&lt;&lt;&lt;/g,'<blockquote>$1</blockquote>')
      .replace(/^\\*\\* (.*$)/gim,'<li style="margin-left:2em">$1</li>')
      .replace(/^\\* (.*$)/gim,'<li>$1</li>')
      .replace(/^# (.*$)/gim,'<li>$1</li>')
      .replace(/^\\|(.+)\\|$/gim,function(m,cells){var tds=cells.split('|').map(function(c){var t=c.trim();if(t.charAt(0)==='!')return '<th>'+t.substring(1).trim()+'</th>';return '<td>'+t+'</td>';});return '<tr>'+tds.join('')+'</tr>';});
    html=html.replace(/(<li>.*?<\\/li>\\n?)+/g,function(m){return '<ul>'+m+'</ul>';});
    html=html.replace(/(<tr>.*?<\\/tr>\\n?)+/g,function(m){return '<table border="1" cellpadding="4" cellspacing="0">'+m+'</table>';});
    html=html.split('\\n\\n').map(function(b){b=b.trim();if(!b||b.charAt(0)==='<')return b;return '<p>'+b.replace(/\\n/g,'<br>')+'</p>';}).join('\\n');
    return html;
  }
  function renderTiddler(title){var t=tiddlers[title];if(!t)return '<div><h2>'+title+'</h2><p>Tiddler not found</p></div>';return '<article class="tc-tiddler"><h2>'+t.title+'</h2>'+wikiToHtml(t.text)+'</article>';}
  var story=tiddlers['$:/StoryList'];
  var open=story&&store.querySelector('[title="$:/StoryList"]').getAttribute('list');
  var list=open?open.split(' ').filter(Boolean):[${JSON.stringify(name)}];
  var c=document.createElement('main');
  c.style.cssText='font-family:Georgia,serif;max-width:820px;margin:2em auto;padding:0 1em;line-height:1.6;color:#222';
  list.forEach(function(t){if(tiddlers[t]&&(tiddlers[t].type||'').indexOf('image/')!==0)c.innerHTML+=renderTiddler(t);});
  document.body.appendChild(c);
  document.addEventListener('click',function(e){var el=e.target;while(el&&el!==document.body){if(el.tagName==='A'&&el.getAttribute('data-tiddler')){e.preventDefault();var n=el.getAttribute('data-tiddler');if(tiddlers[n]){var d=document.createElement('div');d.innerHTML=renderTiddler(n);c.appendChild(d.firstChild);d.scrollIntoView({behavior:'smooth'});}return;}el=el.parentNode;}});
})();
</script>
</body>
</html>`;
}

/** Pull the main tiddler body (wiki markup) out of a TinyWiki HTML doc. */
export function extractBodyWiki(html: string, preferredTitle?: string): string {
  if (typeof DOMParser === "undefined") return "";
  if (!isTinyWikiHtml(html)) return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const store = doc.getElementById("storeArea");
    if (!store) return "";
    const divs = Array.from(store.querySelectorAll("div[title]"));
    let pick = preferredTitle ? divs.find((d) => d.getAttribute("title") === preferredTitle) : undefined;
    if (!pick) {
      pick = divs.find((d) => {
        const t = d.getAttribute("title") || "";
        const ty = d.getAttribute("type") || "";
        return !t.startsWith("$:/") && !ty.startsWith("image/");
      });
    }
    const pre = pick?.querySelector("pre");
    return pre?.textContent ?? "";
  } catch {
    return "";
  }
}

/**
 * Verify a string is a well-formed TinyWiki HTML document.
 * Browser-only (needs DOMParser); on the server, callers should skip validation.
 */
export function validateTinyWikiHtml(html: string): void {
  if (typeof html !== "string" || !html.trim()) {
    throw new Error("File is empty.");
  }
  if (!isTinyWikiHtml(html)) {
    throw new Error('Not a TinyWiki file: missing <div id="storeArea">.');
  }
  if (typeof DOMParser === "undefined") return;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    throw new Error("File could not be parsed as HTML.");
  }
  if (!doc.documentElement || doc.documentElement.tagName.toLowerCase() !== "html") {
    throw new Error("File does not contain a valid <html> root element.");
  }
  const store = doc.getElementById("storeArea");
  if (!store || store.tagName.toLowerCase() !== "div") {
    throw new Error('TinyWiki structure invalid: <div id="storeArea"> not found after parsing.');
  }
  const tiddlers = Array.from(store.children).filter(
    (el) => el.tagName.toLowerCase() === "div" && el.hasAttribute("title"),
  );
  if (!tiddlers.length) {
    throw new Error('TinyWiki structure invalid: storeArea contains no <div title="…"> tiddlers.');
  }
  const valid = tiddlers.filter((d) => {
    const title = d.getAttribute("title");
    if (!title || !title.trim()) return false;
    const pres = Array.from(d.children).filter((c) => c.tagName.toLowerCase() === "pre");
    if (pres.length !== 1) return false;
    return (pres[0].textContent ?? "").trim().length > 0;
  });
  if (!valid.length) {
    throw new Error('TinyWiki structure invalid: no tiddler has the required <div title="…"><pre>…</pre></div> structure with non-empty content.');
  }
  const content = valid.find((d) => {
    const t = d.getAttribute("title") || "";
    const ty = d.getAttribute("type") || "";
    return !t.startsWith("$:/") && !ty.startsWith("image/");
  });
  if (!content) {
    throw new Error("TinyWiki structure invalid: no content tiddler (only system/image tiddlers found).");
  }
}

export function filenameForExport(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${safe}.html`;
}

export function nameFromFilename(filename: string): string {
  const base = filename.replace(/\.(html?|md|markdown|txt)$/i, "").trim();
  if (!base) throw new Error(`Invalid filename: "${filename}" has no usable name after stripping the extension.`);
  return base;
}
