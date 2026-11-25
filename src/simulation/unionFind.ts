export class UnionFind {
  private parent = new Map<string, string>()
  add(a: string) { if (!this.parent.has(a)) this.parent.set(a, a) }
  find(a: string): string {
    this.add(a)
    let r = a
    while (this.parent.get(r) !== r) r = this.parent.get(r)!
    while (a !== r) { const n = this.parent.get(a)!; this.parent.set(a, r); a = n }
    return r
  }
  union(a: string, b: string) { this.parent.set(this.find(a), this.find(b)) }
  keys() { return [...this.parent.keys()] }
}
