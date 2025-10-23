import fs from "fs/promises"
import path from "path"
import type { Purchase, Vendor } from "./types"

const DATA_DIR = path.join(process.cwd(), "data")
const PURCHASES_FILE = path.join(DATA_DIR, "purchases.json")
const VENDORS_FILE = path.join(DATA_DIR, "vendors.json")

async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
  }
}

async function readJSON<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const data = await fs.readFile(filePath, "utf-8")
    return JSON.parse(data)
  } catch {
    return defaultValue
  }
}

async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  await ensureDataDir()
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

export const db = {
  purchases: {
    async getAll(): Promise<Purchase[]> {
      return readJSON(PURCHASES_FILE, [])
    },
    async getById(id: string): Promise<Purchase | null> {
      const purchases = await this.getAll()
      return purchases.find((p) => p.id === id) || null
    },
    async create(purchase: Purchase): Promise<Purchase> {
      const purchases = await this.getAll()
      purchases.push(purchase)
      await writeJSON(PURCHASES_FILE, purchases)
      return purchase
    },
    async update(id: string, data: Partial<Purchase>): Promise<Purchase | null> {
      const purchases = await this.getAll()
      const index = purchases.findIndex((p) => p.id === id)
      if (index === -1) return null
      purchases[index] = { ...purchases[index], ...data, updatedAt: new Date().toISOString() }
      await writeJSON(PURCHASES_FILE, purchases)
      return purchases[index]
    },
    async delete(id: string): Promise<boolean> {
      const purchases = await this.getAll()
      const filtered = purchases.filter((p) => p.id !== id)
      if (filtered.length === purchases.length) return false
      await writeJSON(PURCHASES_FILE, filtered)
      return true
    },
  },
  vendors: {
    async getAll(): Promise<Vendor[]> {
      return readJSON(VENDORS_FILE, [])
    },
    async getByCNPJ(cnpj: string): Promise<Vendor | null> {
      const vendors = await this.getAll()
      return vendors.find((v) => v.cnpj === cnpj) || null
    },
    async create(vendor: Vendor): Promise<Vendor> {
      const vendors = await this.getAll()
      vendors.push(vendor)
      await writeJSON(VENDORS_FILE, vendors)
      return vendor
    },
  },
}
