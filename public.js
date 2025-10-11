let web3, provider, account;
let sale, usdt, kjc;

const el = (id)=>document.getElementById(id);
function toast(msg, type='info'){
  const box = el('toast');
  if (!box) return alert(msg);
  box.style.display='block';
  box.textContent = msg;
  box.style.borderColor = (type==='ok')? '#225b2a' : (type==='err')? '#5b2222' : '#1b1c25';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ box.style.display='none'; }, 3000);
}

// === CONNECT WALLET ===
async function connect(){
  try{
    provider = window.ethereum;
    if(!provider){ toast('ไม่พบ MetaMask / Bitget Wallet', 'err'); return; }

    await provider.request({ method:'eth_requestAccounts' });
    web3 = new Web3(provider);
    const chainId = await web3.eth.getChainId();
    if (web3.utils.toHex(chainId) !== window.NETWORK.chainIdHex)
      await provider.request({ method:'wallet_switchEthereumChain', params:[{ chainId: window.NETWORK.chainIdHex }] });

    const accs = await web3.eth.getAccounts();
    account = accs[0];
    el('wallet').textContent = `✅ ${account.slice(0,6)}…${account.slice(-4)}`;
    el('ca').textContent = window.ADDR.CONTRACT;

    sale = new web3.eth.Contract(window.SALE_ABI, window.ADDR.CONTRACT);
    usdt = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.USDT);
    kjc  = new web3.eth.Contract(window.ERC20_MINI_ABI, window.ADDR.KJC);

    hydrateRefFromUrlOrStore();
    await loadPackages();
    await refreshRewards();
    await loadStakes();

    provider.on?.('accountsChanged', ()=>location.reload());
    provider.on?.('chainChanged', ()=>location.reload());
  }catch(e){ console.error(e); toast(`เชื่อมต่อไม่สำเร็จ: ${e.message}`,'err'); }
}

// === REF HANDLING ===
function hydrateRefFromUrlOrStore(){
  const url = new URL(location.href);
  const urlRef = url.searchParams.get('ref');
  const lsRef  = localStorage.getItem('kjc_ref') || '';
  const candidate = urlRef || lsRef || '';
  if(candidate && web3.utils.isAddress(candidate)){
    el('refInput').value = candidate;
    if(urlRef) localStorage.setItem('kjc_ref', urlRef);
  }
}
function lockRef(){
  const r = el('refInput').value.trim();
  if(!r){ toast('กรุณาใส่ Referrer','err'); return; }
  if(!web3.utils.isAddress(r)){ toast('Referrer ไม่ถูกต้อง','err'); return; }
  localStorage.setItem('kjc_ref', r);
  toast('บันทึก Referrer แล้ว ✅','ok');
}

// === PACKAGE LOADING / BUY ===
async function loadPackages(){
  const wrap = el('pkgWrap');
  wrap.innerHTML = 'กำลังโหลด...';
  try{
    const count = await sale.methods.packageCount().call();
    const items = [];
    for(let i=1;i<=Number(count);i++){
      const p = await sale.methods.packages(i).call();
      if(p.active) items.push({ id:i, usdt:p.usdtIn, kjc:p.kjcOut });
    }
    wrap.innerHTML = '';
    (items.length?items:window.UI_CONST.FALLBACK_PACKAGES).forEach(p=>{
      const card = document.createElement('div');
      card.className='pkg';
      card.innerHTML=`
        <h3>แพ็กเกจ #${p.id}</h3>
        <div>จ่าย: ${Number(p.usdt)/(10**window.DECIMALS.USDT)} USDT</div>
        <div>รับ: ${Number(p.kjc)/(10**window.DECIMALS.KJC)} KJC</div>
        <button onclick="buyPackage(${p.id})">ซื้อแพ็กเกจ</button>`;
      wrap.appendChild(card);
    });
  }catch(e){ wrap.innerHTML='❌ โหลดไม่สำเร็จ'; }
}

async function ensureAllowance(spender, amount){
  const a = await usdt.methods.allowance(account, spender).call();
  if(BigInt(a) >= BigInt(amount)) return true;
  toast('อนุมัติ USDT...');
  await usdt.methods.approve(spender, amount).send({from:account});
  toast('อนุมัติแล้ว ✅','ok');
}

async function buyPackage(id){
  try{
    const p = await sale.methods.packages(id).call();
    await ensureAllowance(window.ADDR.CONTRACT, p.usdtIn);
    let ref = el('refInput').value.trim() || localStorage.getItem('kjc_ref') || '0x0000000000000000000000000000000000000000';
    toast('กำลังส่งธุรกรรม...');
    await sale.methods.buyPackage(id, ref).send({from:account});
    toast('ซื้อสำเร็จและ stake อัตโนมัติ ✅','ok');
    await refreshRewards();
    await loadStakes();
  }catch(e){ toast(`❌ ${e.message}`,'err'); }
}

// === REWARDS ===
async function refreshRewards(){
  try{
    const amt = await sale.methods.accruedRefUSDT(account).call();
    el('refUsdt').textContent = `${Number(amt)/(10**window.DECIMALS.USDT)} USDT`;
  }catch{ el('refUsdt').textContent = '-'; }
}
async function claimReferral(){
  try{
    toast('ส่งธุรกรรมเคลมรางวัล...');
    await sale.methods.claimReferralReward().send({from:account});
    toast('เคลมสำเร็จ ✅','ok');
    await refreshRewards();
  }catch(e){ toast(`❌ ${e.message}`,'err'); }
}

// === STAKES ===
async function loadStakes(){
  const box = el('stakes');
  box.innerHTML = 'กำลังโหลด...';
  try{
    const n = await sale.methods.getStakeCount(account).call();
    if(Number(n)===0){ box.innerHTML='ยังไม่มี stake'; return; }
    box.innerHTML='';
    for(let i=0;i<Number(n);i++){
      const s = await sale.methods.stakes(account,i).call();
      const pend = await sale.methods.pendingStakeReward(account,i).call();
      const canUn = await sale.methods.canUnstake(account,i).call();
      const card = document.createElement('div');
      card.className='stake';
      card.innerHTML=`
        <div>Index #${i}</div>
        <div>Principal: ${Number(s.amount)/(10**window.DECIMALS.KJC)} KJC</div>
        <div>รอเคลม: ${Number(pend)/(10**window.DECIMALS.KJC)} KJC</div>
        <button onclick="claimStake(${i})">เคลม</button>
        <button onclick="unstake(${i})" ${!canUn?'disabled':''}>Unstake</button>`;
      box.appendChild(card);
    }
  }catch(e){ box.innerHTML='❌ โหลด stake ไม่สำเร็จ'; }
}

async function claimStake(i){
  try{
    toast('กำลังเคลม...');
    await sale.methods.claimStakingReward(i).send({from:account});
    toast('เคลมสำเร็จ ✅','ok');
    await loadStakes();
  }catch(e){ toast(`❌ ${e.message}`,'err'); }
}

async function unstake(i){
  try{
    toast('ส่งธุรกรรม Unstake...');
    await sale.methods.unstake(i).send({from:account});
    toast('Unstake สำเร็จ ✅','ok');
    await loadStakes();
  }catch(e){ toast(`❌ ${e.message}`,'err'); }
}

window.addEventListener('DOMContentLoaded',()=>{
  el('btnConnect')?.addEventListener('click', connect);
  el('btnLockRef')?.addEventListener('click', lockRef);
  el('btnClaimRef')?.addEventListener('click', claimReferral);
});
