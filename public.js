// public.js
let web3;
let account;
let sale;
const contractAddress = "0x055b98549ff7622fba30dc324e89ecd9ba4f244e"; // <<== แก้ตามของคุณ
const usdtAddress = "0x55d398326f99059ff775485246999027b3197955";   // USDT BEP20 (18 decimals)

// ✅ ABI ของ KJCPackageReferralAutoStake (เวอร์ชันล่าสุด)
const saleABI = [
  {"inputs":[{"internalType":"uint256","name":"packageId","type":"uint256"},{"internalType":"address","name":"ref","type":"address"}],"name":"buyPackage","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[],"name":"claimReferralReward","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"index","type":"uint256"}],"name":"claimStakingReward","outputs":[],"stateMutability":"nonpayable","type":"function"},
  {"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"referrerOf","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
  {"inputs":[],"name":"packageCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
  {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"packages","outputs":[
    {"internalType":"uint256","name":"usdtIn","type":"uint256"},
    {"internalType":"uint256","name":"kjcOut","type":"uint256"},
    {"internalType":"bool","name":"active","type":"bool"}],"stateMutability":"view","type":"function"}
];

const usdtABI = [
  {"constant":false,"inputs":[{"name":"spender","type":"address"},{"name":"value","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"type":"function"},
  {"constant":true,"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"}
];

function el(id){ return document.getElementById(id); }

function toast(msg, type="info"){
  const div = document.createElement("div");
  div.textContent = msg;
  div.style.position = "fixed";
  div.style.bottom = "20px";
  div.style.left = "50%";
  div.style.transform = "translateX(-50%)";
  div.style.padding = "10px 20px";
  div.style.background = type==="err" ? "red" : type==="ok" ? "green" : "gold";
  div.style.color = "#fff";
  div.style.borderRadius = "8px";
  document.body.appendChild(div);
  setTimeout(()=>div.remove(),2500);
}

// ---------------- CONNECT WALLET ----------------
async function connectWallet(){
  try{
    if(!window.ethereum) return toast("กรุณาติดตั้ง MetaMask หรือ Bitget Wallet","err");
    web3 = new Web3(window.ethereum);
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    account = accounts[0];
    sale = new web3.eth.Contract(saleABI, contractAddress);
    el("wallet").textContent = account.slice(0,6)+"..."+account.slice(-4);
    toast("เชื่อมต่อกระเป๋าสำเร็จ","ok");
    loadReferrer();
    loadPackages();
  }catch(e){ console.error(e); toast("เชื่อมต่อไม่สำเร็จ: "+e.message,"err"); }
}

// ---------------- BIND REFERRER ----------------
function bindReferrer(){
  const ref = el("refInput").value.trim();
  if(!web3.utils.isAddress(ref)) return toast("Referrer address ไม่ถูกต้อง","err");
  localStorage.setItem("kjc_ref", ref);
  toast("ระบบจะผูก Referrer อัตโนมัติเมื่อซื้อแพ็กเกจครั้งแรก ✅","ok");
}

// ---------------- LOAD PACKAGES ----------------
async function loadPackages(){
  try{
    const count = await sale.methods.packageCount().call();
    const listDiv = el("packageList");
    listDiv.innerHTML = "";
    for(let i=1;i<=count;i++){
      const p = await sale.methods.packages(i).call();
      if(!p.active) continue;
      const box = document.createElement("div");
      box.className = "package-box";
      box.innerHTML = `
        <p>แพ็กเกจ #${i}</p>
        <p>จ่าย: ${(p.usdtIn/1e18).toFixed(0)} USDT</p>
        <p>รับ: ${(p.kjcOut/1e18).toFixed(0)} KJC</p>
        <button onclick="buyPackage(${i})">ซื้อแพ็กเกจ</button>
      `;
      listDiv.appendChild(box);
    }
  }catch(e){ console.error(e); toast("โหลดแพ็กเกจไม่สำเร็จ","err"); }
}

// ---------------- BUY PACKAGE ----------------
async function buyPackage(id){
  try{
    if(!account) return toast("กรุณาเชื่อมต่อกระเป๋าก่อน","err");
    const ref = localStorage.getItem("kjc_ref") || "0x0000000000000000000000000000000000000000";
    const pack = await sale.methods.packages(id).call();
    const amount = pack.usdtIn;
    const usdt = new web3.eth.Contract(usdtABI, usdtAddress);

    // ✅ อนุมัติ USDT ก่อน
    await usdt.methods.approve(contractAddress, amount).send({from: account});
    toast("อนุมัติ USDT สำเร็จ","ok");

    // ✅ ซื้อแพ็กเกจ
    await sale.methods.buyPackage(id, ref).send({from: account});
    toast("ซื้อแพ็กเกจสำเร็จ ✅","ok");
  }catch(e){ console.error(e); toast("ไม่สามารถซื้อแพ็กเกจได้: "+e.message,"err"); }
}

// ---------------- LOAD REFERRER INFO ----------------
async function loadReferrer(){
  try{
    const ref = await sale.methods.referrerOf(account).call();
    if(ref !== "0x0000000000000000000000000000000000000000"){
      el("refDisplay").textContent = ref;
    }else{
      el("refDisplay").textContent = "(ยังไม่มี)";
    }
  }catch(e){ console.error(e); }
}
