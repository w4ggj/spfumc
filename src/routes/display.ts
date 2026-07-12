import { Hono } from 'hono';
import type { Env, SessionData } from '../types';

function imageUrl(request: Request, r2Key: string): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/img/${r2Key}`;
}

async function computeConfigVersion(
  groupId: string | null,
  updatedAt: number,
  imageIds: string[],
  rotationSpeed: number,
  shuffle: number
): Promise<string> {
  const payload = `${groupId}:${updatedAt}:${imageIds.join(',')}:${rotationSpeed}:${shuffle}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

const displayHTML = (token: string, orientation: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Display</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100vw;height:100vh;overflow:hidden;background:#000}
#stage{position:fixed;top:0;left:0;width:100%;height:100%;background:#000}
.portrait #stage{
  top:50%;left:50%;
  width:100vh;height:100vw;
  transform:translate(-50%,-50%) rotate(90deg);
  transform-origin:center center
}
.slide{
  position:absolute;top:0;left:0;width:100%;height:100%;
  object-fit:cover;opacity:0;transition:opacity 1s ease-in-out
}
.slide.active{opacity:1}
#idle{
  position:fixed;top:0;left:0;width:100%;height:100%;
  background:#0d0d0d;display:none;flex-direction:column;align-items:center;justify-content:center;gap:28px
}
#idle img{width:320px;max-width:70vw;height:auto;opacity:.85}
#idle p{color:#555;font-family:Georgia,serif;font-size:1.1rem;letter-spacing:.12em;text-transform:uppercase}
</style>
</head>
<body class="${orientation === 'portrait' ? 'portrait' : ''}">
<div id="stage"></div>
<div id="idle"><img src="/logo.webp" alt="St. Pete First UMC"><p>No content assigned</p></div>
<script>
(function(){
const TOKEN='${token}';
let cfg=null,playlist=[],idx=0,timer=null,pollTimer=null,curImg=null,version=null;
const stage=document.getElementById('stage');
const idle=document.getElementById('idle');

function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=0|Math.random()*(i+1);[b[i],b[j]]=[b[j],b[i]];}return b;}

function preload(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});}

function showIdle(){idle.style.display='flex';stage.innerHTML='';clearTimeout(timer);timer=null;curImg=null;}

function createSlide(url){
  const img=document.createElement('img');
  img.className='slide';img.src=url;img.loading='eager';
  return img;
}

async function advance(){
  if(!playlist.length){showIdle();return;}
  idle.style.display='none';
  const nextIdx=(idx+1)%playlist.length;
  const nextUrl=playlist[nextIdx].url;

  // Preload next
  try{await preload(nextUrl);}catch(e){}

  const nextSlide=createSlide(nextUrl);
  stage.appendChild(nextSlide);

  // Fade out current, fade in next
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      nextSlide.classList.add('active');
      if(curImg){
        const old=curImg;
        old.classList.remove('active');
        setTimeout(()=>old.remove(),1100);
      }
      curImg=nextSlide;
      idx=nextIdx;
    });
  });

  const speed=(cfg?.group?.rotation_speed||8)*1000;
  timer=setTimeout(advance,speed);
}

function buildPlaylist(config){
  if(!config.group||!config.images.length)return[];
  const imgs=config.group.shuffle?shuffle(config.images):[...config.images];
  return imgs;
}

function startPlaylist(){
  // Show first image immediately, crossfading from whatever is on screen
  clearTimeout(timer);
  timer=null;
  idle.style.display='none';
  idx=0;
  const firstSlide=createSlide(playlist[0].url);
  if(curImg){
    stage.appendChild(firstSlide);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      firstSlide.classList.add('active');
      const old=curImg;
      old.classList.remove('active');
      setTimeout(()=>old.remove(),1100);
      curImg=firstSlide;
    }));
  } else {
    stage.innerHTML='';
    stage.appendChild(firstSlide);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{firstSlide.classList.add('active');curImg=firstSlide;}));
  }
  const speed=(cfg?.group?.rotation_speed||8)*1000;
  timer=setTimeout(advance,speed);
}

function applyConfig(config,forceRestart){
  const newVersion=config.config_version;
  if(!forceRestart&&newVersion===version)return;
  version=newVersion;
  cfg=config;
  playlist=buildPlaylist(config);
  if(!playlist.length){showIdle();return;}
  startPlaylist();
}

async function poll(){
  try{
    const res=await fetch('/api/display/'+TOKEN,{cache:'no-store'});
    if(!res.ok){if(res.status===404){showIdle();}return;}
    const data=await res.json();
    await applyConfig(data,false);
  }catch(e){}
}

async function init(){
  let data=null;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const res=await fetch('/api/display/'+TOKEN,{cache:'no-store'});
      if(res.status===404){showIdle();return;}
      if(res.ok){data=await res.json();break;}
    }catch(e){}
    await new Promise(r=>setTimeout(r,2000));
  }
  if(!data){showIdle();return;}
  await applyConfig(data,true);
  pollTimer=setInterval(poll,10000);
}

init();
})();
</script>
</body>
</html>`;

const app = new Hono<{ Bindings: Env; Variables: { session: SessionData } }>();

// Display HTML page — public, token-gated
app.get('/display/:token', async (c) => {
  const { token } = c.req.param();
  const screen = await c.env.DB.prepare(
    'SELECT id, orientation FROM screens WHERE url_token = ?'
  ).bind(token).first<{ id: string; orientation: string }>();
  if (!screen) return c.text('Not found', 404);
  return new Response(displayHTML(token, screen.orientation), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});

// Display config API — public, token-gated
app.get('/api/display/:token', async (c) => {
  const { token } = c.req.param();
  const screen = await c.env.DB.prepare(
    'SELECT * FROM screens WHERE url_token = ?'
  ).bind(token).first<{
    id: string; orientation: string; active_group_id: string | null;
  }>();
  if (!screen) return c.json({ error: 'Not found' }, 404);

  const noCache = { headers: { 'Cache-Control': 'no-store, no-cache' } };
  if (!screen.active_group_id) {
    const version = await computeConfigVersion(null, 0, [], 0, 0);
    return c.json({
      screen: { orientation: screen.orientation },
      group: null,
      images: [],
      config_version: version,
    }, 200, noCache.headers);
  }

  const group = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?')
    .bind(screen.active_group_id)
    .first<{ id: string; rotation_speed: number; shuffle: number; updated_at: number }>();
  if (!group) {
    const version = await computeConfigVersion(null, 0, [], 0, 0);
    return c.json({
      screen: { orientation: screen.orientation },
      group: null,
      images: [],
      config_version: version,
    }, 200, { 'Cache-Control': 'no-store, no-cache' });
  }

  const imageRows = await c.env.DB.prepare(`
    SELECT i.r2_key, i.display_name, gi.image_id
    FROM group_images gi
    JOIN images i ON gi.image_id = i.id
    WHERE gi.group_id = ?
    ORDER BY gi.position ASC
  `).bind(screen.active_group_id).all();

  const images = (imageRows.results as any[]).map(img => ({
    url: imageUrl(c.req.raw, img.r2_key),
    display_name: img.display_name,
  }));
  const imageIds = (imageRows.results as any[]).map(img => img.image_id);

  const version = await computeConfigVersion(
    screen.active_group_id, group.updated_at, imageIds,
    group.rotation_speed, group.shuffle
  );

  return c.json({
    screen: { orientation: screen.orientation },
    group: { rotation_speed: group.rotation_speed, shuffle: group.shuffle === 1 },
    images,
    config_version: version,
  }, 200, { 'Cache-Control': 'no-store, no-cache' });
});

export default app;
