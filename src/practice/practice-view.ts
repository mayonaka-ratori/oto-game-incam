import type { HandOffset, PracticeFrame } from "./practice-timeline";

export function createPracticeView(root: HTMLElement): void {
  root.innerHTML = `
    <main class="practice-shell" data-practice-state="idle">
      <header class="practice-header">
        <div class="practice-brand"><span class="practice-brand-mark" aria-hidden="true">♪</span><span>Oto <small>動きの練習</small></span></div>
        <span class="practice-badge">カメラなし・30秒</span>
      </header>
      <div class="practice-layout">
        <section class="practice-guide-panel" aria-label="動きのお手本">
          <div class="practice-instruction">
            <p id="practice-section">曲とお手本に合わせて</p>
            <h1 id="practice-instruction">両手を 楽な高さに</h1>
            <p id="practice-detail">小さな動きで大丈夫。画面と同じ向きに動きます。</p>
          </div>
          <div class="practice-stage">
            <svg id="practice-guide" viewBox="0 0 400 340" role="img" aria-label="座った人が両手を動かすお手本">
              <defs>
                <linearGradient id="practice-shirt" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#294c53"/><stop offset="1" stop-color="#173139"/></linearGradient>
              </defs>
              <ellipse cx="200" cy="323" rx="113" ry="8" fill="#0b171f"/>
              <path d="M128 287H272M146 287L139 321M254 287L261 321" fill="none" stroke="#35505a" stroke-width="7" stroke-linecap="round"/>
              <path d="M177 266L170 310M223 266L230 310" fill="none" stroke="#20383f" stroke-width="25" stroke-linecap="round"/>
              <path d="M175 132Q200 122 225 132L242 168L234 269Q200 281 166 269L158 168Z" fill="url(#practice-shirt)" stroke="#375a60" stroke-width="1.5"/>
              <path d="M200 108V133" stroke="#dcc1a7" stroke-width="17" stroke-linecap="round"/>
              <circle cx="200" cy="84" r="27" fill="#ead2b9"/>
              <path d="M176 78Q175 51 201 54Q227 54 225 78Q212 60 196 68Q186 72 176 78" fill="#34505b"/>
              <path d="M190 92Q200 99 210 92" fill="none" stroke="#9c7869" stroke-width="2" stroke-linecap="round"/>
              <g fill="none" stroke-dasharray="3 7" stroke-width="1.5" opacity="0.6">
                <path id="practice-path-left" stroke="#8ce4d6"/>
                <path id="practice-path-right" stroke="#ffc7b0"/>
              </g>
              <circle id="practice-target-left" r="18" fill="none" stroke="#8ce4d6" stroke-width="1.5" stroke-dasharray="3 5" opacity="0.5"/>
              <circle id="practice-target-right" r="18" fill="none" stroke="#ffc7b0" stroke-width="1.5" stroke-dasharray="3 5" opacity="0.5"/>
              <polyline id="practice-arm-left" fill="none" stroke="#8ce4d6" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline id="practice-arm-right" fill="none" stroke="#ffc7b0" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
              <g id="practice-hand-left"><circle r="21" fill="#8ce4d6" opacity="0.08"/><path d="M-9 7V-9Q-8-16-3-12L0-17Q4-19 6-12L11-5Q15-4 13 2L8 13H-3Z" fill="#c5f5e9" stroke="#8ce4d6" stroke-width="1.5"/></g>
              <g id="practice-hand-right"><circle r="21" fill="#ffc7b0" opacity="0.08"/><path d="M9 7V-9Q8-16 3-12L0-17Q-4-19-6-12L-11-5Q-15-4-13 2L-8 13H3Z" fill="#ffe1cf" stroke="#ffc7b0" stroke-width="1.5"/></g>
              <text x="200" y="333" text-anchor="middle" fill="#89a1a8" font-size="11">あなたから見た向き</text>
            </svg>
            <div id="practice-countdown" class="practice-countdown" hidden><span>4拍きいたら はじめよう</span><strong id="practice-count-number">4</strong></div>
          </div>
          <div id="practice-beats" class="practice-beats" role="group" aria-label="8拍の流れ">
            ${Array.from({ length: 8 }, (_, index) => `<span data-beat="${index}">${index + 1}</span>`).join("")}
          </div>
          <div class="practice-next"><span>つぎ</span><strong id="practice-next">両手を 右上へ</strong></div>
        </section>
        <section class="practice-controls" aria-label="練習の操作">
          <div id="practice-intro" class="practice-intro">
            <p class="practice-eyebrow">まずは、動いてみよう</p>
            <h2>曲に合わせて、<br>ゆっくり両手を。</h2>
            <p>スマホを置いて、座って遊びます。<br>お手本の手を、同じ向きにまねしてみてください。</p>
            <div class="practice-tips"><span>両手を一緒に</span><span>楽に届く幅で</span><span>途中にひと休み</span></div>
            <p class="practice-small">動きやすさを試す練習です。点数は付きません。</p>
          </div>
          <div id="practice-session" class="practice-session" hidden>
            <div class="practice-time"><span>のこり</span><strong id="practice-remaining">30</strong><span>秒</span></div>
            <progress id="practice-progress" max="30" value="0" aria-label="曲の進み具合"></progress>
            <p class="practice-small">肩を上げすぎず、楽に届く幅で。</p>
          </div>
          <div id="practice-complete" hidden>
            <p class="practice-eyebrow">曲はここまで</p>
            <h2>30秒 おつかれさま</h2>
            <p>曲に合わせて、自然に動けましたか？</p>
          </div>
          <div class="practice-actions">
            <label class="practice-volume" for="practice-volume"><span>音量</span><input id="practice-volume" type="range" min="0" max="100" value="65" aria-label="音量"/><output id="practice-volume-value" for="practice-volume">65%</output></label>
            <button id="practice-start" class="practice-primary" type="button">音を出して はじめる <span aria-hidden="true">→</span></button>
            <button id="practice-stop" class="practice-secondary" type="button" hidden>やめる</button>
            <p id="practice-status" class="practice-status" role="status">4拍の合図のあと、30秒動きます。音が出ます。</p>
          </div>
          <form id="practice-feedback" class="practice-feedback" hidden>
            <h3>よければ、感想を残す</h3>
            ${feedbackQuestion("ease", "動きやすかった？", ["動きやすかった", "少し動きにくかった", "動きにくかった"])}
            ${feedbackQuestion("fatigue", "腕は疲れた？", ["疲れなかった", "少し疲れた", "疲れた"])}
            ${feedbackQuestion("replay", "もう一度やりたい？", ["やりたい", "どちらともいえない", "今はやりたくない"])}
            <label class="practice-comment" for="practice-comment">気になったところ（任意）<textarea id="practice-comment" name="comment" rows="2" maxlength="2000" placeholder="動きの速さ、お手本の見やすさなど"></textarea></label>
            <button class="practice-secondary" type="submit">感想をファイルに保存</button>
            <p class="practice-small">回答だけを手元へ保存します。自動では送信しません。</p>
            <p id="practice-save-status" role="status"></p>
          </form>
        </section>
      </div>
      <footer class="practice-footer"><span>指の形は自由。無理なく動ける範囲で。</span><a href="?">計測画面へ</a></footer>
    </main>`;
}

export class PracticeGuide {
  readonly #elements: readonly {
    arm: SVGPolylineElement;
    hand: SVGGElement;
    path: SVGPathElement;
    target: SVGCircleElement;
    side: number;
  }[];
  readonly #beats: readonly HTMLElement[];
  readonly #instruction: HTMLElement;
  readonly #next: HTMLElement;
  readonly #detail: HTMLElement;

  constructor(root: HTMLElement) {
    this.#elements = ["left", "right"].map((side, index) => ({
      arm: required(root, `#practice-arm-${side}`),
      hand: required(root, `#practice-hand-${side}`),
      path: required(root, `#practice-path-${side}`),
      target: required(root, `#practice-target-${side}`),
      side: index === 0 ? -1 : 1,
    }));
    this.#beats = [...root.querySelectorAll<HTMLElement>("[data-beat]")];
    this.#instruction = required(root, "#practice-instruction");
    this.#next = required(root, "#practice-next");
    this.#detail = required(root, "#practice-detail");
    this.draw({ x: 0, y: 0 });
  }

  update(frame: PracticeFrame): void {
    this.draw(frame.handOffset, frame.targetOffset);
    setText(this.#instruction, frame.label);
    setText(this.#next, frame.nextLabel);
    setText(this.#detail, frame.motion === "rest" ? "力を抜いて。曲はそのまま続きます。" : "2拍かけて、ゆっくり動かそう。");
    this.beat(frame.beatInPhrase, frame.phraseBeats);
  }

  beat(active: number, total: number): void {
    for (const [index, element] of this.#beats.entries()) {
      element.hidden = index >= total;
      element.classList.toggle("is-active", index === active);
      element.classList.toggle("is-past", index < active);
    }
  }

  draw(offset: HandOffset, target: HandOffset = offset): void {
    for (const element of this.#elements) {
      const shoulderX = 200 + element.side * 44;
      const homeX = 200 + element.side * 42;
      const wristX = homeX + offset.x;
      const wristY = 245 + offset.y;
      const elbowX = shoulderX + element.side * 27 + (wristX - shoulderX) * 0.4;
      const elbowY = 199 + Math.max(0, wristY - 157) * 0.25;
      element.arm.setAttribute("points", `${shoulderX},157 ${elbowX},${elbowY} ${wristX},${wristY}`);
      element.hand.setAttribute("transform", `translate(${wristX} ${wristY})`);
      element.target.setAttribute("cx", String(homeX + target.x));
      element.target.setAttribute("cy", String(245 + target.y));
      element.path.setAttribute("d", `M${wristX} ${wristY}L${homeX + target.x} ${245 + target.y}`);
    }
  }
}

export function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Practice element was not found: ${selector}`);
  return element;
}

export function setText(element: Element, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function feedbackQuestion(name: string, question: string, answers: readonly string[]): string {
  return `<fieldset><legend>${question}</legend><div>${answers.map((answer) => `<label><input type="radio" name="${name}" value="${answer}"/><span>${answer}</span></label>`).join("")}</div></fieldset>`;
}
