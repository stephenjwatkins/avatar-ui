class Events {
  constructor() {
    this.targets = {};
  }
  on(eventType, fn) {
    this.targets[eventType] = this.targets[eventType] || [];
    this.targets[eventType].push(fn);
  }
  off(eventType, fn) {
    this.targets[eventType] = this.targets[eventType].filter((t) => t !== fn);
  }
  fire(eventType, ...args) {
    (this.targets[eventType] || []).forEach((fn) => fn(...args));
  }
}

export default Events;
