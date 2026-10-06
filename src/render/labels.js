import * as THREE from 'three';

/** Lightweight HTML labels projected from 3D positions every frame. */
export class Labels {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'labels';
    container.appendChild(this.el);
    this.items = [];
    this.v = new THREE.Vector3();
    this.visible = true;
  }
  add(text, pos, opts = {}) {
    const div = document.createElement('div');
    div.className = 'label ' + (opts.cls || '');
    div.textContent = text;
    this.el.appendChild(div);
    const item = { div, pos: pos.clone(), maxDist: opts.maxDist ?? 40000, minDist: opts.minDist ?? 0, group: opts.group || 'place', priority: opts.priority || 0 };
    this.items.push(item);
    return item;
  }
  remove(item) { item.div.remove(); this.items = this.items.filter((i) => i !== item); }
  update(camera, w, h, hiddenGroups) {
    this.el.style.display = this.visible ? '' : 'none';
    if (!this.visible) return;
    // nearest labels win; anything that would overlap an already-placed label is hidden
    for (const it of this.items) it.d = camera.position.distanceTo(it.pos);
    const order = [...this.items].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.d - b.d);
    const placed = [];
    for (const it of order) {
      const d = it.d;
      if (hiddenGroups.has(it.group) || d > it.maxDist || d < it.minDist) { it.div.style.display = 'none'; continue; }
      this.v.copy(it.pos).project(camera);
      if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) { it.div.style.display = 'none'; continue; }
      const sx = ((this.v.x + 1) / 2) * w, sy = ((1 - this.v.y) / 2) * h;
      it.w ??= it.div.textContent.length * 6.6 + 12;
      const r = { x0: sx - it.w / 2, x1: sx + it.w / 2, y0: sy - 22, y1: sy };
      if (placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) { it.div.style.display = 'none'; continue; }
      placed.push(r);
      it.div.style.display = '';
      it.div.style.transform = `translate(-50%, -100%) translate(${sx}px, ${sy}px)`;
    }
  }
}
