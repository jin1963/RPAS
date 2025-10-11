/* public-app/public.js
 * UI + Logic ฝั่งผู้ใช้ เชื่อม MetaMask, โหลดแพ็กเกจ, ซื้อ, เคลมรางวัล, แสดง stakes
*/

let web3, provider, account;
let sale, usdt, kjc;

const el = (id)=>document.getElementById(id);
const fmt = (v,dec=18,dp=6)=>{
  try{
    const s = (BigInt(v)).toString();
    if(dec===0) return s;
    const neg = s.startsWith('-');
    const raw = neg?s.slice(1):s;
    const pad = raw.padStart(dec+1,'0');
    const a = pad.slice(0, pad.length-dec);
    const b = pad.slice(pad.length-dec).replace(/0+$/,'');
    return (neg?'-':'') + (b?`${a}.${b}`:a);
  }catch{ return v?.toString?.() ?? String(v); }
};
const toWei = (numStr,dec=18)=>{
  const [i,d='']= String(numStr).split('.');
  const frac = (d + '0'.repeat(dec)).slice(0,dec);
  return (BigInt(i||0)* (10n**BigInt(dec)) + BigInt(frac||0)).toString();
};

function toast(msg, type='info'){
  const box = el('toast');
  box.style.display='block';
  box.innerHTML = msg;
  box.style.borderColor = (type==='ok')? '#225b2a' : (type==='err')? '#5b2222' : '#1b1c25';
  setTimeout(()=>{ box.style.display='none'; }, 3800);
}

// ---- Provider / Contracts ----
async function connect(){
  try{
    provider = window.ethereum;
    if(!provider){ toast('ไม่พบ MetaMask/Wallet — เปิดด้วย DApp browser', 'err'); return; }
    await provider.request({ method:'eth_requestAccounts' });
    web3 = new Web3(provider);

    // chain check
    const chainId = await web3.eth.getChainId();
    if (web3.utils.toHex(chainId) !== window.NETWORK.chainIdHex){
      await provider.request({ method:'wallet_switchEthereumChain', params:[{ chainId: window.NETWORK.chainIdHex }] });
    }

    const accs = await web3.eth.getAccounts();
    account = accs[0];
    el('wallet').textContent = `✅ ${account.slice(0,6)}…${account.slice(-4)}`;
    el('ca').textContent = window.ADDR.CONTRACT;

    // instances
    sale = new web3.eth.Contract(window.SALE_ABI, window.ADDR.CONTRACT);
    usdt = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.USDT);
    kjc  = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.KJC);

    // auto-fill ref
    hydrateRefFromUrlOrStore();

    // load data
    await loadPackages();
    await refreshRewards();
    await loadStakes();

    // listeners
    provider.on?.('accountsChanged', ()=>location.reload());
    provider.on?.('chainChanged',   ()=>location.reload());
  }catch(e){
    console.error(e);
    toast(`เชื่อมต่อไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// ---- Ref handling ----
function hydrateRefFromUrlOrStore(){
  const url = new URL(location.href);
  const urlRef = url.searchParams.get('ref');
  const lsRef  = localStorage.getItem('kjc_ref') || '';
  const candidate = urlRef || lsRef || '';
  if (candidate && web3.utils.isAddress(candidate)){
    el('refInput').value = candidate;
    if (urlRef) localStorage.setItem('kjc_ref', urlRef);
  }
}

function lockRef(){
  const r = el('refInput').value.trim();
  if (!r){ toast('กรุณาใส่ Referrer ก่อน', 'err'); return; }
  if (!web3.utils.isAddress(r)){ toast('Referrer ไม่ถูกต้อง', 'err'); return; }
  localStorage.setItem('kjc_ref', r);
  toast('บันทึก Referrer แล้ว ✅', 'ok');
}

// ---- Packages ----
async function loadPackages(){
  const wrap = el('pkgWrap');
  wrap.innerHTML = 'กำลังโหลดแพ็กเกจ…';
  try{
    const count = await sale.methods.packageCount().call();
    const items = [];
    if (Number(count)>0){
      for (let i=1;i<=Number(count);i++){
        const p = await sale.methods.packages(i).call();
        if (p.active) items.push({ id:i, usdt:p.usdtIn, kjc:p.kjcOut });
      }
    }
    const data = (items.length? items : window.UI_CONST.FALLBACK_PACKAGES);
    wrap.innerHTML = '';
    for (const p of data){
      const card = document.createElement('div');
      card.className = 'pkg';
      card.innerHTML = `
        <h3>แพ็กเกจ #${p.id}</h3>
        <div class="muted">จ่าย (USDT): <span class="mono">${fmt(p.usdt, window.DECIMALS.USDT)}</span></div>
        <div class="muted">รับ (KJC): <span class="mono">${fmt(p.kjc,  window.DECIMALS.KJC)}</span></div>
        <div class="actions">
          <button data-id="${p.id}" class="btnBuy">ซื้อแพ็กเกจ</button>
        </div>
        <div class="note">* จะถูก Stake อัตโนมัติทันที</div>
      `;
      wrap.appendChild(card);
    }
    [...document.querySelectorAll('.btnBuy')].forEach(btn=>{
      btn.addEventListener('click', ()=>buyPackage(Number(btn.dataset.id)));
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

    // ref selection: URL/locked input/fallback zero
    let ref = el('refInput').value.trim() || localStorage.getItem('kjc_ref') || '0x0000000000000000000000000000000000000000';
    if (ref && !web3.utils.isAddress(ref)) return toast('Referrer ไม่ถูกต้อง','err');

    // read package to know USDT in
    const p = await sale.methods.packages(id).call();
    if (!p.active) return toast('แพ็กเกจนี้ถูกปิดแล้ว','err');

    await ensureAllowance(window.ADDR.CONTRACT, p.usdtIn);

    toast('กำลังส่งธุรกรรมซื้อ + stake…');
    await sale.methods.buyPackage(id, ref).send({ from: account });
    toast('ซื้อสำเร็จและ stake อัตโนมัติแล้ว ✅','ok');

    // remember ref forever after first purchase
    if (ref && web3.utils.isAddress(ref)) localStorage.setItem('kjc_ref', ref);

    await refreshRewards();
    await loadStakes();
  }catch(e){
    console.error(e);
    toast(`ซื้อไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// ---- Rewards ----
async function refreshRewards(){
  try{
    const amt = await sale.methods.accruedRefUSDT(account).call();
    el('refUsdt').textContent = `${fmt(amt, window.DECIMALS.USDT)} USDT`;
  }catch(e){
    el('refUsdt').textContent = '-';
  }
}

async function claimReferral(){
  try{
    toast('ส่งธุรกรรมเคลม Referral…');
    await sale.methods.claimReferralReward().send({ from: account });
    toast('เคลม Referral สำเร็จ ✅','ok');
    await refreshRewards();
  }catch(e){
    toast(`เคลมไม่สำเร็จ: ${e?.message||e}`,'err');
  }
}

// ---- Stakes ----
async function loadStakes(){
  const box = el('stakes');
  box.innerHTML = 'กำลังโหลด stakes…';
  try{
    const n = await sale.methods.getStakeCount(account).call();
    box.innerHTML = '';
    if (Number(n)===0){
      box.innerHTML = '<div class="muted">ยังไม่มีรายการ stake</div>';
      return;
    }
    for (let i=0;i<Number(n);i++){
      // โครงสร้าง stakes[user][i] = { amount, startTime, lastClaim, withdrawn }
      const s = await sale.methods.stakes(account, i).call();
      const nextClaim = await sale.methods.nextStakeClaimTime(account, i).call();
      const canUn = await sale.methods.canUnstake(account, i).call();
      const pend   = await sale.methods.pendingStakeReward(account, i).call();

      const now = Math.floor(Date.now()/1000);
      const canClaim = Number(nextClaim) > 0 && now >= Number(nextClaim);
      const y = document.createElement('div');
      y.className = 'stake';
      y.innerHTML = `
        <div class="mono">Index #${i}</div>
        <div>Principal: <span class="mono">${fmt(s.amount, window.DECIMALS.KJC)} KJC</span></div>
        <div>คาดว่าจะเคลมได้: <span class="mono">${fmt(pend, window.DECIMALS.KJC)} KJC</span></div>
        <div class="muted">เริ่ม: ${ new Date(Number(s.startTime)*1000).toLocaleString() }</div>
        <div class="muted">ถัดไป: ${ Number(nextClaim)? new Date(Number(nextClaim)*1000).toLocaleString() : '-' }</div>
        <div class="actions">
          <button data-i="${i}" class="btnClaimStake" ${!canClaim?'disabled':''}>เคลมผลตอบแทน</button>
          <button data-i="${i}" class="btnUnstake" ${!canUn?'disabled':''}>Unstake เมื่อครบล็อก</button>
        </div>
      `;
      box.appendChild(y);
    }
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

// ---- init & wire ----
window.addEventListener('DOMContentLoaded', ()=>{
  el('btnConnect').addEventListener('click', connect);
  el('btnLockRef').addEventListener('click', lockRef);
  el('btnClaimRef').addEventListener('click', claimReferral);
  // แสดง CA เบื้องต้น
  el('ca').textContent = window.ADDR.CONTRACT;
});
