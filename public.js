/* public.js — DApp ฝั่งผู้ใช้: เชื่อม MetaMask, สมัคร/ลิงก์แนะนำ, ซื้อแพ็ก, เคลม, แสดง stakes */

let web3, provider, account;
let sale, usdt, kjc; // contracts

// --------- helpers ----------
const el = (id)=>document.getElementById(id);
const fmt = (v,dec=18)=>{
  try{
    const s = BigInt(v).toString();
    if (dec===0) return s;
    const neg = s.startsWith('-');
    const raw = neg ? s.slice(1) : s;
    const need = dec + 1;
    const pad = raw.padStart(need, '0');
    const a = pad.slice(0, pad.length - dec);
    const b = pad.slice(pad.length - dec).replace(/0+$/,'');
    return (neg?'-':'') + (b?`${a}.${b}`:a);
  }catch{ return v?.toString?.() ?? String(v); }
};
function toast(msg, type='info'){
  const box = el('toast');
  box.style.display = 'block';
  box.textContent = msg;
  box.className = `toast ${type}`;
  setTimeout(()=>{ box.style.display = 'none'; }, 3800);
}

// --------- connect ----------
async function connect(){
  try{
    provider = window.ethereum;
    if (!provider) { toast('ไม่พบ MetaMask/Wallet — โปรดเปิดด้วย DApp browser','err'); return; }

    // ขอสิทธิ์
    await provider.request({ method: 'eth_requestAccounts' });
    web3 = new Web3(provider);

    // เช็ค chain
    const chainId = await web3.eth.getChainId();
    if (web3.utils.toHex(chainId) !== window.NETWORK.chainIdHex){
      await provider.request({ method:'wallet_switchEthereumChain', params:[{ chainId: window.NETWORK.chainIdHex }] });
    }

    // บัญชี
    const accs = await web3.eth.getAccounts();
    account = accs[0];
    el('wallet').textContent = `✅ ${account.slice(0,6)}…${account.slice(-4)}`;
    el('ca').textContent = window.ADDR.CONTRACT;

    // instances
    sale = new web3.eth.Contract(window.SALE_ABI, window.ADDR.CONTRACT);
    usdt = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.USDT);
    kjc  = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.KJC);

    // auto hydrate ref + สร้างลิงก์ของฉัน
    hydrateRefFromUrlOrStore();
    renderMyRefLink();

    // โหลดข้อมูล
    await loadPackages();
    await refreshRewards();
    await loadStakes();

    provider.on?.('accountsChanged', ()=>location.reload());
    provider.on?.('chainChanged', ()=>location.reload());
  }catch(e){
    console.error(e);
    toast(`เชื่อมต่อไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// --------- ref handling ----------
function hydrateRefFromUrlOrStore(){
  try{
    const url = new URL(location.href);
    const urlRef = url.searchParams.get('ref');
    const lsRef  = localStorage.getItem('kjc_ref') || '';
    const candidate = urlRef || lsRef || '';
    if (candidate && web3.utils.isAddress(candidate)){
      el('refInput').value = candidate;
      if (urlRef) localStorage.setItem('kjc_ref', urlRef);
    }
  }catch{}
}
function lockRef(){
  const r = el('refInput').value.trim();
  if (!r){ toast('กรุณาใส่ Referrer ก่อน', 'err'); return; }
  if (!web3.utils.isAddress(r)){ toast('Referrer ไม่ถูกต้อง', 'err'); return; }
  localStorage.setItem('kjc_ref', r);
  toast('บันทึก Referrer แล้ว ✅', 'ok');
}
function renderMyRefLink(){
  if (!account){ el('myRefLink').value = '(ยังไม่มี — สมัครก่อน)'; return; }
  const link = `${location.origin}${location.pathname}?ref=${account}`;
  el('myRefLink').value = link;
}
function copyMyRef(){
  const i = el('myRefLink');
  i.select(); i.setSelectionRange(0, 99999);
  document.execCommand?.('copy');
  navigator.clipboard?.writeText(i.value);
  toast('คัดลอกลิงก์แล้ว ✅','ok');
}

// สมัครเป็นผู้ถูกแนะนำ (call setReferrer)
async function registerReferrer(){
  try{
    if (!sale) return toast('กรุณาเชื่อมต่อกระเป๋าก่อน','err');
    const ref = el('refInput').value.trim();
    if (!ref || !web3.utils.isAddress(ref)){
      toast('กรุณาใส่ address ผู้นำแนะนำให้ถูกต้อง','err');
      return;
    }
    toast('กำลังส่งธุรกรรมสมัครเป็นผู้ถูกแนะนำ…');
    await sale.methods.setReferrer(ref).send({ from: account });
    toast('สมัครสำเร็จ ✅','ok');

    // จดจำและโชว์ลิงก์ของฉัน
    localStorage.setItem('kjc_ref', ref);
    renderMyRefLink();
  }catch(e){
    console.error(e);
    toast(`สมัครไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// --------- packages ----------
async function loadPackages(){
  const wrap = el('pkgWrap');
  wrap.innerHTML = 'กำลังโหลดแพ็กเกจ…';
  try{
    const count = await sale.methods.packageCount().call();
    const items = [];
    for (let i=1; i<=Number(count); i++){
      const p = await sale.methods.packages(i).call();
      if (p.active) items.push({ id:i, usdt:p.usdtIn, kjc:p.kjcOut });
    }
    if (!items.length){ wrap.innerHTML = '<div class="muted">ยังไม่มีแพ็กเกจเปิดขาย</div>'; return; }

    wrap.innerHTML = '';
    for (const p of items){
      const card = document.createElement('div');
      card.className = 'pkg';
      card.innerHTML = `
        <h3>แพ็กเกจ #${p.id}</h3>
        <div class="muted">จ่าย: <span class="mono">${fmt(p.usdt, window.DECIMALS.USDT)} USDT</span></div>
        <div class="muted">รับ: <span class="mono">${fmt(p.kjc,  window.DECIMALS.KJC)} KJC</span></div>
        <div class="actions">
          <button data-id="${p.id}" class="btnBuy">ซื้อแพ็กเกจ</button>
        </div>
        <div class="note">* จะถูก Stake อัตโนมัติทันที</div>
      `;
      wrap.appendChild(card);
    }
    [...document.querySelectorAll('.btnBuy')].forEach(b=>{
      b.addEventListener('click', ()=>buyPackage(Number(b.dataset.id)));
    });
  }catch(e){
    console.error(e);
    wrap.innerHTML = '<span class="err">โหลดแพ็กเกจไม่สำเร็จ</span>';
  }
}

async function ensureAllowance(spender, amount){
  const a = await usdt.methods.allowance(account, spender).call();
  if (BigInt(a) >= BigInt(amount)) return true;
  toast('กำลังอนุมัติ USDT…');
  await usdt.methods.approve(spender, amount).send({ from: account });
  toast('อนุมัติ USDT สำเร็จ ✅','ok');
  return true;
}

async function buyPackage(id){
  try{
    if (!sale) return toast('กรุณาเชื่อมต่อกระเป๋าก่อน','err');

    // ใช้ ref จาก input > localStorage > zero
    let ref = el('refInput').value.trim() || localStorage.getItem('kjc_ref') || '0x0000000000000000000000000000000000000000';
    if (ref && !web3.utils.isAddress(ref)) return toast('Referrer ไม่ถูกต้อง','err');

    // ตรวจดูค่า USDT ที่ต้องจ่ายจาก package ก่อน approve
    const p = await sale.methods.packages(id).call();
    if (!p.active) return toast('แพ็กเกจนี้ถูกปิดแล้ว','err');

    await ensureAllowance(window.ADDR.CONTRACT, p.usdtIn);

    toast('กำลังส่งธุรกรรมซื้อ + stake…');
    await sale.methods.buyPackage(id, ref).send({ from: account });
    toast('ซื้อสำเร็จและ stake อัตโนมัติแล้ว ✅','ok');

    // จำ ref หลังการซื้อครั้งแรก
    if (ref && web3.utils.isAddress(ref)) localStorage.setItem('kjc_ref', ref);

    await refreshRewards();
    await loadStakes();
  }catch(e){
    console.error(e);
    toast(`ซื้อไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// --------- rewards ----------
async function refreshRewards(){
  try{
    const amt = await sale.methods.accruedRefUSDT(account).call();
    el('refUsdt').textContent = `${fmt(amt, window.DECIMALS.USDT)} USDT`;
  }catch{ el('refUsdt').textContent = '-'; }
}
async function claimReferral(){
  try{
    toast('ส่งธุรกรรมเคลม Referral…');
    await sale.methods.claimReferralReward().send({ from: account });
    toast('เคลม Referral สำเร็จ ✅','ok');
    await refreshRewards();
  }catch(e){ toast(`เคลมไม่สำเร็จ: ${e?.message||e}`,'err'); }
}

// --------- stakes ----------
async function loadStakes(){
  const box = el('stakes');
  box.innerHTML = 'กำลังโหลด stakes…';
  try{
    const n = await sale.methods.getStakeCount(account).call();
    if (Number(n)===0){ box.innerHTML = '<div class="muted">ยังไม่มีรายการ stake</div>'; return; }
    box.innerHTML = '';
    for (let i=0; i<Number(n); i++){
      const s  = await sale.methods.stakes(account, i).call(); // {amount,startTime,lastClaim,withdrawn}
      const nc = await sale.methods.nextStakeClaimTime(account, i).call();
      const canUn  = await sale.methods.canUnstake(account, i).call();
      const pend   = await sale.methods.pendingStakeReward(account, i).call();
      const now    = Math.floor(Date.now()/1000);
      const canClaim = Number(nc) > 0 && now >= Number(nc);

      const row = document.createElement('div');
      row.className = 'stake';
      row.innerHTML = `
        <div class="mono">Index #${i}</div>
        <div>Principal: <span class="mono">${fmt(s.amount, window.DECIMALS.KJC)} KJC</span></div>
        <div>คาดว่าจะเคลมได้: <span class="mono">${fmt(pend, window.DECIMALS.KJC)} KJC</span></div>
        <div class="muted">เริ่ม: ${ new Date(Number(s.startTime)*1000).toLocaleString() }</div>
        <div class="muted">ถัดไป: ${ Number(nc)? new Date(Number(nc)*1000).toLocaleString() : '-' }</div>
        <div class="actions">
          <button class="btnClaimStake" data-i="${i}" ${!canClaim?'disabled':''}>เคลมผลตอบแทน</button>
          <button class="btnUnstake" data-i="${i}" ${!canUn?'disabled':''}>Unstake เมื่อครบล็อก</button>
        </div>
      `;
      box.appendChild(row);
    }
    // bind
    [...document.querySelectorAll('.btnClaimStake')].forEach(b=>{
      b.addEventListener('click', async ()=>{
        const i = Number(b.dataset.i);
        try{
          toast('ส่งธุรกรรมเคลมผลตอบแทน…');
          await sale.methods.claimStakingReward(i).send({ from: account });
          toast('เคลมผลตอบแทนสำเร็จ ✅','ok');
          await loadStakes();
        }catch(e){ toast(`เคลมไม่สำเร็จ: ${e?.message||e}`,'err'); }
      });
    });
    [...document.querySelectorAll('.btnUnstake')].forEach(b=>{
      b.addEventListener('click', async ()=>{
        const i = Number(b.dataset.i);
        try{
          toast('ส่งธุรกรรม Unstake…');
          await sale.methods.unstake(i).send({ from: account });
          toast('Unstake สำเร็จ ✅','ok');
          await loadStakes();
        }catch(e){ toast(`Unstake ไม่สำเร็จ: ${e?.message||e}`,'err'); }
      });
    });
  }catch(e){
    console.error(e);
    box.innerHTML = '<span class="err">โหลด stakes ไม่สำเร็จ</span>';
  }
}

// --------- wire events ----------
window.addEventListener('DOMContentLoaded', ()=>{
  el('btnConnect').addEventListener('click', connect);
  el('btnLockRef').addEventListener('click', lockRef);
  el('btnRegisterRef').addEventListener('click', registerReferrer); // ✅
  el('btnCopyMyRef').addEventListener('click', copyMyRef);
  el('btnClaimRef').addEventListener('click', claimReferral);
  el('ca').textContent = window.ADDR.CONTRACT;
});
