const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const unzipper = require("unzipper");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const TMP_DIR = path.join(DATA_DIR, "tmp");
const META_FILE = path.join(DATA_DIR, "meta.json");
for (const d of [DATA_DIR, UPLOADS_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

const IMG_RE = /\.(jpe?g|png|webp|gif|avif)$/i;
const STATUSES = ["Draft", "Approved", "Winner", "Rejected"];

app.use(express.json({ limit: "4mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "public")));

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, "utf8")); } catch (e) { return {}; }
}
function saveMeta(m) {
  const tmp = META_FILE + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
  fs.renameSync(tmp, META_FILE);
}
function applyEdit(cur, src) {
  if (src.name !== undefined) cur.name = src.name;
  if (src.status !== undefined) cur.status = src.status;
  if (src.notes !== undefined) cur.notes = src.notes;
  return cur;
}

app.get("/healthz", (_q, r) => r.type("text").send("ok"));

app.get("/api/uploads", (_q, res) => {
  const items = [];
  try {
    for (const run of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
      if (!run.isDirectory()) continue;
      const dir = path.join(UPLOADS_DIR, run.name);
      for (const f of fs.readdirSync(dir)) {
        if (IMG_RE.test(f)) {
          items.push({ key: run.name + "/" + f, run: run.name, file: f, url: "/uploads/" + run.name + "/" + f });
        }
      }
    }
  } catch (e) {}
  res.json({ items });
});

app.get("/api/meta", (_q, res) => res.json(loadMeta()));

app.post("/api/meta", (req, res) => {
  const b = req.body || {};
  if (!b.key) return res.status(400).json({ error: "key required" });
  const m = loadMeta();
  m[b.key] = applyEdit(m[b.key] || {}, b);
  saveMeta(m);
  res.json({ ok: true, key: b.key, meta: m[b.key] });
});

app.post("/api/meta/bulk", (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
  const m = loadMeta();
  let n = 0;
  for (const it of items) {
    if (!it || !it.key) continue;
    m[it.key] = applyEdit(m[it.key] || {}, it);
    n++;
  }
  saveMeta(m);
  res.json({ ok: true, updated: n });
});

app.delete("/api/run/:runId", (req, res) => {
  const runId = req.params.runId;
  if (!runId || runId.includes("/") || runId.includes("..") || runId.includes("\\")) {
    return res.status(400).json({ error: "invalid runId" });
  }
  const dir = path.join(UPLOADS_DIR, runId);
  if (!dir.startsWith(UPLOADS_DIR + path.sep) || !fs.existsSync(dir)) {
    return res.status(404).json({ error: "run not found" });
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    const m = loadMeta();
    let removed = 0;
    for (const k of Object.keys(m)) {
      if (k.startsWith(runId + "/")) { delete m[k]; removed++; }
    }
    saveMeta(m);
    res.json({ ok: true, deleted: runId, meta_entries_removed: removed });
  } catch (err) {
    res.status(500).json({ error: "delete failed: " + err.message });
  }
});

const upload = multer({ dest: TMP_DIR, limits: { fileSize: 250 * 1024 * 1024 } });
app.post("/upload", upload.single("zip"), async (req, res) => {
  if (!req.file) return res.status(400).send("No zip uploaded (form field zip).");
  const runId = (req.body.run_id || "run-" + Date.now()).replace(/[^a-zA-Z0-9._-]/g, "-");
  const dest = path.join(UPLOADS_DIR, runId);
  fs.mkdirSync(dest, { recursive: true });
  try {
    await fs.createReadStream(req.file.path)
      .pipe(unzipper.Parse())
      .on("entry", (entry) => {
        const base = path.basename(entry.path);
        if (entry.type === "File" && IMG_RE.test(base) && !base.startsWith(".") && !entry.path.includes("__MACOSX")) {
          entry.pipe(fs.createWriteStream(path.join(dest, base.replace(/[^a-zA-Z0-9._-]/g, "_"))));
        } else {
          entry.autodrain();
        }
      })
      .promise();
    fs.unlink(req.file.path, () => {});
    res.redirect("/");
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    res.status(500).send("Unzip failed: " + err.message);
  }
});

app.get("/upload", (_q, res) => res.type("html").send(UPLOAD_PAGE));
app.get("/", (_q, res) => res.type("html").send(DASHBOARD_PAGE));
app.listen(PORT, () => console.log("luna-creative-assets listening on :" + PORT));

const UPLOAD_PAGE = `<!doctype html><html><head><meta charset="utf-8"> <meta name="viewport" content="width=device-width,initial-scale=1"><title>Upload — Luna Creative Assets</title> <style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fafafa;margin:0} .w{max-width:560px;margin:0 auto;padding:32px}a{color:#1f6f54} .card{background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:22px} input,button{font-size:15px}button{margin-top:14px;background:#1f6f54;color:#fff;border:0;border-radius:8px;padding:10px 18px;cursor:pointer} .drop{border:2px dashed #d4d4d8;border-radius:12px;padding:30px;text-align:center;color:#71717a}</style></head> <body><div class="w"><a href="/">&larr; Dashboard</a><h1>Upload a creative bundle</h1> <div class="card"><form method="post" action="/upload" enctype="multipart/form-data"> <div class="drop">Run name<br><input name="run_id" value="batch" style="margin:8px 0"><br> Zip of images<br><input type="file" name="zip" accept=".zip" required></div> <button type="submit">Upload</button></form></div></div></body></html>`;

const DASHBOARD_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Luna Creative Dashboard</title>
<style>
:root{--brand:#1f6f54}
*{box-sizing:border-box}
body{margin:0;background:#fafafa;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
.eyebrow{color:var(--brand);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0}
h1{margin:4px 0 2px;font-size:28px}
.sub{color:#71717a;font-size:14px;margin:0}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
.upbtn{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:9px 14px;font-size:14px;text-decoration:none}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
.fbtn{border:1px solid #d4d4d8;background:#fff;border-radius:999px;padding:6px 14px;font-size:14px;cursor:pointer}
.fbtn.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.search{border:1px solid #d4d4d8;border-radius:8px;padding:8px 10px;font-size:14px;min-width:220px;flex:1}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden}
.imgwrap{aspect-ratio:1;background:#f4f4f5}
.imgwrap img{width:100%;height:100%;object-fit:cover;display:block}
.meta{padding:10px}
.name{font-size:14px;font-weight:500;color:#27272a;cursor:text;min-height:18px;outline:none;border-radius:4px}
.name:focus{background:#f4f4f5;box-shadow:0 0 0 2px var(--brand)}
.run{font-size:11px;color:#a1a1aa;margin:2px 0}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:3px 10px;border-radius:999px;cursor:pointer;margin-top:6px;user-select:none}
.b-Draft{background:#f4f4f5;color:#52525b}
.b-Approved{background:#dcfce7;color:#166534}
.b-Winner{background:#fef9c3;color:#854d0e}
.b-Rejected{background:#fee2e2;color:#991b1b}
.notes{font-size:12px;color:#71717a;cursor:text;margin-top:6px;min-height:16px;outline:none;border-radius:4px}
.notes:empty:before{content:'+ note';color:#c4c4c8}
.notes:focus{background:#f4f4f5;box-shadow:0 0 0 2px var(--brand)}
</style></head><body><div class="wrap">
<div class="top"><div>
<p class="eyebrow">Brand Creative Work</p>
<h1>Luna Creative Dashboard</h1>
<p class="sub" id="sub">Loading…</p></div>
<a class="upbtn" href="/upload">Upload bundle</a></div>
<div class="filters" id="filters"></div>
<input class="search" id="q" placeholder="Search name, run, notes…" style="margin-bottom:14px">
<div class="grid" id="grid"></div>
</div>
<script>
var STATUSES=["Draft","Approved","Winner","Rejected"];
var ITEMS=[],META={},FILTER="All",Q="";
function save(key,patch){
  META[key]=Object.assign({},META[key]||{},patch);
  fetch("/api/meta",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(Object.assign({key:key},patch))}).catch(function(){});
}
function nm(it){return (META[it.key]&&META[it.key].name)||it.file.replace(/\.[a-z]+$/i,"");}
function st(it){return (META[it.key]&&META[it.key].status)||"Draft";}
function nt(it){return (META[it.key]&&META[it.key].notes)||"";}
function render(){
  var counts={All:ITEMS.length};STATUSES.forEach(function(s){counts[s]=0;});
  ITEMS.forEach(function(it){counts[st(it)]++;});
  var fb=document.getElementById("filters");fb.innerHTML="";
  ["All"].concat(STATUSES).forEach(function(s){
    var b=document.createElement("button");b.className="fbtn"+(FILTER===s?" on":"");
    b.textContent=s+" ("+(counts[s]||0)+")";b.onclick=function(){FILTER=s;render();};fb.appendChild(b);
  });
  var q=Q.toLowerCase();
  var list=ITEMS.filter(function(it){
    if(FILTER!=="All"&&st(it)!==FILTER)return false;
    if(q){var h=(nm(it)+" "+it.run+" "+nt(it)).toLowerCase();if(h.indexOf(q)<0)return false;}
    return true;
  });
  document.getElementById("sub").textContent=list.length+" of "+ITEMS.length+" creatives";
  var g=document.getElementById("grid");g.innerHTML="";
  list.forEach(function(it){
    var c=document.createElement("div");c.className="card";
    var s=st(it);
    c.innerHTML='<div class="imgwrap"><img loading="lazy" src="'+it.url+'"></div>'+
      '<div class="meta">'+
      '<div class="name" contenteditable="true" spellcheck="false"></div>'+
      '<div class="run">'+it.run+'</div>'+
      '<span class="badge b-'+s+'">'+s+'</span>'+
      '<div class="notes" contenteditable="true" spellcheck="false"></div>'+
      '</div>';
    var nameEl=c.querySelector(".name");nameEl.textContent=nm(it);
    nameEl.addEventListener("blur",function(){var v=nameEl.textContent.trim();save(it.key,{name:v});});
    var notesEl=c.querySelector(".notes");notesEl.textContent=nt(it);
    notesEl.addEventListener("blur",function(){save(it.key,{notes:notesEl.textContent.trim()});});
    var badge=c.querySelector(".badge");
    badge.addEventListener("click",function(){
      var cur=st(it);var next=STATUSES[(STATUSES.indexOf(cur)+1)%STATUSES.length];
      save(it.key,{status:next});badge.className="badge b-"+next;badge.textContent=next;render();
    });
    g.appendChild(c);
  });
}
document.getElementById("q").addEventListener("input",function(e){Q=e.target.value;render();});
Promise.all([fetch("/api/uploads").then(function(r){return r.json();}),
  fetch("/api/meta").then(function(r){return r.json();})])
  .then(function(res){ITEMS=(res[0].items||[]).sort(function(a,b){return a.key<b.key?-1:1;});META=res[1]||{};render();});
</script></body></html>`;
