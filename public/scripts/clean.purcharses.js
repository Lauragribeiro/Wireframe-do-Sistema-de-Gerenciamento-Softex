// scripts/clean-purchases.js
import fs from "fs";
const file = "./data/purchases.json";

const raw = fs.readFileSync(file, "utf8");
const all = JSON.parse(raw || "{}");

for (const pid of Object.keys(all)) {
  all[pid] = (all[pid] || []).map(row => {
    // troca "[object Object]" por nada e mantém nomes válidos
    const cleanDocs = (row.docs || [])
      .map(x => typeof x === "string" ? x : "")
      .filter(x => x && x !== "[object Object]");
    // opcional: preservar "Comprovante (colado)" se existir
    row.docs = [...new Set(cleanDocs)];
    return row;
  });
}

fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf8");
console.log("✔ purchases.json limpo");
