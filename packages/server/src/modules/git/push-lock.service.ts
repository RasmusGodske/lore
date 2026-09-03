import { Injectable } from "@nestjs/common";

/**
 * Pushes are serialized. The hook checks that a pushed commit contains main and
 * post-receive fast-forwards main to it; holding this lock across the whole
 * receive-pack means main cannot move between those two steps.
 */
@Injectable()
export class PushLockService {
  private chain: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(fn, fn);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}
