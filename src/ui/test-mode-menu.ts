/**
 * The start screen lists the tests a tester may be asked to run, so nobody has to type a query
 * string. Choosing one reloads the page with that test's query; the rest of the query is kept.
 */

export type TestModeId = "portrait-three" | "speed-check" | "regression" | "remaining-two" | "five";

export interface TestModeOption {
  readonly id: TestModeId;
  readonly label: string;
  readonly detail: string;
  /** Path and query to open this test from the current page. */
  readonly href: string;
  readonly current: boolean;
  /** The first group is what testers are normally asked for; the rest sits under "そのほか". */
  readonly group: "main" | "other";
}

interface TestModeDefinition {
  readonly id: TestModeId;
  readonly label: string;
  readonly detail: string;
  readonly group: "main" | "other";
  readonly mode: string | null;
  readonly protocol: string | null;
}

const DEFINITIONS: readonly TestModeDefinition[] = [
  {
    id: "portrait-three",
    label: "いつものテスト",
    detail: "スワイプ・リフト・ななめリフト 各10回。約5分",
    group: "main",
    mode: null,
    protocol: null,
  },
  {
    id: "speed-check",
    label: "速度チェック",
    detail: "両手を映して待つだけ。約2分",
    group: "main",
    mode: "speedcheck",
    protocol: null,
  },
  {
    id: "regression",
    label: "確認テスト",
    detail: "エアタップ・リフト・スポットライト 各3回。約1分半",
    group: "main",
    mode: null,
    protocol: "regression",
  },
  {
    id: "remaining-two",
    label: "スワイプとBloom",
    detail: "各10回。約3分",
    group: "other",
    mode: null,
    protocol: "remaining-two",
  },
  {
    id: "five",
    label: "5つの動作",
    detail: "各10回、合計50回。約8分",
    group: "other",
    mode: null,
    protocol: "five",
  },
];

/** Which test the given query string opens. Unknown values fall back to the usual test. */
export function currentTestMode(search: string): TestModeId {
  const parameters = new URLSearchParams(search);
  if (parameters.get("mode") === "speedcheck") return "speed-check";
  const protocol = parameters.get("protocol");
  return DEFINITIONS.find((definition) => definition.mode === null && definition.protocol === protocol)?.id
    ?? "portrait-three";
}

export function testModeOptions(pathname: string, search: string): readonly TestModeOption[] {
  const current = currentTestMode(search);
  return DEFINITIONS.map((definition) => {
    const parameters = new URLSearchParams(search);
    parameters.delete("mode");
    parameters.delete("protocol");
    if (definition.mode !== null) parameters.set("mode", definition.mode);
    if (definition.protocol !== null) parameters.set("protocol", definition.protocol);
    const query = parameters.toString();
    return {
      id: definition.id,
      label: definition.label,
      detail: definition.detail,
      href: query === "" ? pathname : `${pathname}?${query}`,
      current: definition.id === current,
      group: definition.group,
    };
  });
}

/** Builds the list. The links are plain anchors, so they work without any script state. */
export function createTestModeMenu(pathname: string, search: string): HTMLElement {
  const options = testModeOptions(pathname, search);
  const menu = document.createElement("nav");
  menu.className = "test-mode-menu";
  menu.id = "test-mode-menu";
  menu.setAttribute("aria-label", "テストの選択");

  const heading = document.createElement("p");
  heading.className = "test-mode-heading";
  heading.textContent = "テストの選択";
  menu.append(heading);

  const mainList = document.createElement("ul");
  mainList.className = "test-mode-list";
  for (const option of options.filter(({ group }) => group === "main")) mainList.append(createItem(option));
  menu.append(mainList);

  const others = options.filter(({ group }) => group === "other");
  const more = document.createElement("details");
  more.className = "test-mode-more";
  // Keep the chosen test in sight when it is one of the less common ones.
  more.open = others.some(({ current }) => current);
  const summary = document.createElement("summary");
  summary.textContent = "そのほかのテスト";
  const otherList = document.createElement("ul");
  otherList.className = "test-mode-list";
  for (const option of others) otherList.append(createItem(option));
  more.append(summary, otherList);
  menu.append(more);
  return menu;
}

function createItem(option: TestModeOption): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.className = "test-mode-option";
  link.href = option.href;
  link.dataset.testMode = option.id;
  if (option.current) link.setAttribute("aria-current", "true");
  const label = document.createElement("strong");
  label.textContent = option.current ? `${option.label}（選択中）` : option.label;
  const detail = document.createElement("span");
  detail.textContent = option.detail;
  link.append(label, detail);
  item.append(link);
  return item;
}
