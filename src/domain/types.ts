export type Score = -5|-4|-3|-2|-1|1|2|3|4|5;
export type Suffix = '01'|'02'|'03'|'04'|'05'|'06'|'07'|'08'|'09'|'10';
export type CaseId = `H${Suffix}` | `K${Suffix}`;
export type AxisId = 1|2|3|4|5|6|7|8|9|10;
export type VerdictId = 'N5'|'N4'|'N3'|'N2'|'N1'|'Z'|'P1'|'P2'|'P3'|'P4'|'P5';
export type Answers = Readonly<Record<CaseId, Score>>;
export type Draft = Partial<Record<CaseId, Score>>;
export type AxisValues = Readonly<Record<AxisId, number>>;
export type DecimalInteger = string; // JSONで精度を失わない10進整数。境界判定はBigInt
export type ContentVersion = string; // 初回 'v1'、意味・式の変更時は新しい版
export type Participant = { id: string; persistent: boolean };
export type Ballot = { version: ContentVersion; answers: Answers; revision: DecimalInteger };
export type IndividualResult = {
  total: number; negativeTotal: number; positiveTotal: number;
  verdict: VerdictId; axes: AxisValues; cumulative: readonly number[];
};
export type Snapshot = {
  version: ContentVersion; revision: DecimalInteger; updatedAt: string;
  count: DecimalInteger; scoreSum: DecimalInteger;
  caseCounts: Readonly<Record<CaseId, Readonly<Record<Score, DecimalInteger>>>>;
  axisSums: Readonly<Record<AxisId, DecimalInteger>>;
  verdictCounts: Readonly<Record<VerdictId, DecimalInteger>>;
};
export type SubmitRequest = {
  version: ContentVersion; answers: Answers;
  requestId: string; expectedRevision: DecimalInteger; // 初回は '0'
};
export type SubmitReceipt = { ballot: Ballot; snapshot: Snapshot };
export type ResultSession = { receipt: SubmitReceipt; individual: IndividualResult };
