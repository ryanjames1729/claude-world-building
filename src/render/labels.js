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
    const item = { div, pos: pos.clone(), maxDist: opts.maxDist ?? 40000, minDist: opts.minDist ?? 0, group: opts.group || 'place' };
    this.items.push(item);
    return item;
  }
  remove(item) { item.div.remove(); this.items = this.items.filter((i) => i !== item); }
  update(camera, w, h, hiddenGroups) {
    this.el.style.display = this.visible ? '' : 'none';
    if (!this.visible) return;
    for (const it of this.items) {
      const d = camera.position.distanceTo(it.pos);
      if (hiddenGroups.has(it.group) || d > it.maxDist || d < it.minDist) { it.div.style.display = 'none'; continue; }
      this.v.copy(it.pos).project(camera);
      if (this.v.z > 1 || this.v.x < -1.1 || this.v.x > 1.1 || this.v.y < -1.1 || this.v.y > 1.1) { it.div.style.display = 'none'; continue; }
      it.div.style.display = '';
      it.div.style.transform = `translate(-50%, -100%) translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px)`;
    }
  }
}
