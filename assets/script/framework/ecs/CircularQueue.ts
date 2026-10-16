//import { Utils } from "../utils/Utils";

export class CircularQueue {
  private data: Int32Array;
  private head: number = 0;
  private tail: number = 0;
  private capacity: number;
  private size: number = 0;
  private mask: number;

  constructor(initialCapacity: number = 128) {
    // 确保容量是2的幂，便于使用位运算替代模运算
    this.capacity = this.nextPowerOfTwo(initialCapacity);
    this.mask = this.capacity - 1;
    this.data = new Int32Array(this.capacity);
  }
  
  // 计算大于等于给定数的最小2的幂
  private nextPowerOfTwo(n: number): number {
    let power = 1;
    while (power < n) {
      power *= 2;
    }
    return power;
  }

  // 入队操作（只接受数字类型）
  enqueue(element: number): void {
    if (this.size >= this.capacity) {
      this.resize();
    }
    
    this.data[this.tail & this.mask] = element;
    this.tail = (this.tail + 1);
    this.size++;
  }

  // private checkAdd(element)
  // {
  //   this._testDict[element] = (this._testDict[element] || 0) + 1
  //   if (this._testDict[element] != 1)
  //   {
  //     Utils.error(" CircularQueue.check"+element)
  //   }
  // }

  // private checkRemove(element)
  // {
  //   this._testDict[element] = (this._testDict[element] || 0) - 1
  //   if (this._testDict[element] != 0)
  //   {
  //     Utils.error(" CircularQueue.check"+element)
  //   }
  // }


  // 出队操作
  dequeue(): number | undefined {
    if (this.size <= 0) {
      return undefined;
    }
    
    const element = this.data[this.head & this.mask];
    this.head = (this.head + 1);
    this.size--;
    return element;
  }

  // 获取队首元素
  peek(): number | undefined {
    if (this.size <= 0) {
      return undefined;
    }
    return this.data[this.head & this.mask];
  }

  // 判断队列是否为空
  isEmpty(): boolean {
    return this.size <= 0;
  }

  // 判断队列是否已满
  isFull(): boolean {
    return this.size >= this.capacity;
  }

  // 获取当前队列长度
  getSize(): number {
    return this.size;
  }

  // 获取队列容量
  getCapacity(): number {
    return this.capacity;
  }

  // 扩容操作，容量翻倍
  private resize(): void {
    const newCapacity = this.capacity * 2;
    const newData = new Int32Array(newCapacity);
    
    // 复制原队列元素到新数组
    if (this.head < this.tail) {
      // 如果队列没有环绕，直接复制
      newData.set(this.data.subarray(this.head & this.mask, this.tail & this.mask), 0);
    } else {
      // 如果队列环绕了，分两段复制
      const elementsInFirstPart = this.capacity - (this.head & this.mask);
      newData.set(this.data.subarray(this.head & this.mask, this.capacity), 0);
      newData.set(this.data.subarray(0, this.tail & this.mask), elementsInFirstPart);
    }
    
    // 更新队列属性
    this.data = newData;
    this.head = 0;
    this.tail = this.size;
    this.capacity = newCapacity;
    this.mask = newCapacity - 1;
  }
}

