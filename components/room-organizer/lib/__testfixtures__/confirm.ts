import { answerConfirm, cancelPendingConfirms, currentConfirm, subscribeConfirm, type ConfirmRequest } from '../confirm-dialog';

export interface AutoAnswer {
  /** Every question asked, in order. */
  asked: ConfirmRequest[];
  /** Stop answering and cancel anything still open. */
  stop(): void;
}

/**
 * Answer every `askConfirm` as it is asked, like a test's old
 * `vi.spyOn(window, 'confirm').mockReturnValue(…)`. The answer is a fixed
 * boolean, or decided per question. The promise still resolves in a
 * microtask, so await (or `waitFor`) what follows the answer.
 */
export function autoAnswerConfirms(answer: boolean | ((request: ConfirmRequest) => boolean)): AutoAnswer {
  const asked: ConfirmRequest[] = [];
  const reply = (): void => {
    const request = currentConfirm();
    if (!request) return;
    asked.push(request);
    answerConfirm(request.id, typeof answer === 'boolean' ? answer : answer(request));
  };
  const unsubscribe = subscribeConfirm(reply);
  reply();
  return {
    asked,
    stop() {
      unsubscribe();
      cancelPendingConfirms();
    },
  };
}
