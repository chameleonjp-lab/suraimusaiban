import { AXES, CASES, CASE_ORDER, VERDICTS } from '../../domain/content';
import type { SubmitReceipt } from '../../domain/types';
import { caseModel, cumulativeModel, signedNumber } from '../../charts/chart-model';
import { renderChart } from '../../charts/chart-svg';
import { element, renderSnapshot, table } from '../status/status-view';
import { mountShare } from '../share/share-view';
import { clearResult, openResult } from './result-state';
export function renderResults(container:HTMLElement,receipt:SubmitReceipt):()=>void {
 const session=openResult(receipt),{individual}=session;const verdict=VERDICTS.find(v=>v.id===individual.verdict)!;
 const header=element('section',undefined,'panel');header.append(element('p','YOUR VERDICT','eyebrow'),element('h1','今回、あなたが下した判決','section-heading'),element('h2',verdict.label));
 const total=element('strong',signedNumber(individual.total));total.dataset.testid='individual-total';const totalLine=element('p','合計点 ');totalLine.append(total,element('span',' / −100〜＋100'));header.append(totalLine);
 const breakdown=element('p',`刑罰側 ${signedNumber(individual.negativeTotal)} ／ 待遇改善側 ${signedNumber(individual.positiveTotal)}`);breakdown.dataset.testid='score-breakdown';header.append(breakdown,element('p','20件は同じ重みで合算しています。刑罰側と待遇改善側の極端な回答も相殺されます。'));
 const answers=element('section',undefined,'panel');answers.dataset.testid='case-results';answers.append(element('h2','20件の判断と、累積点','section-heading'));
 const cases=caseModel(session.receipt.ballot.answers),cumulative=cumulativeModel(session.receipt.ballot.answers);answers.append(renderChart(cases,'bar'),renderChart(cumulative,'line'),table(['出来事','選択値','累積点'],CASE_ORDER.map((id,i)=>[`${String(i+1).padStart(2,'0')} ${CASES.find(c=>c.id===id)!.title}`,signedNumber(session.receipt.ballot.answers[id]),signedNumber(cumulative.series[0].values[i])]),'固定の出来事番号順。発生した時系列ではありません。'));
 const axes=element('section',undefined,'panel');axes.dataset.testid='axis-results';axes.append(element('h2','10項目の根拠を確かめる','section-heading'),table(['判断傾向（0〜100）','値','根拠の2件'],AXES.map(a=>[a.label,String(individual.axes[a.id]),`${String(CASE_ORDER.indexOf(a.h)+1).padStart(2,'0')} ${CASES.find(c=>c.id===a.h)!.title}: ${signedNumber(session.receipt.ballot.answers[a.h])} ／ ${String(CASE_ORDER.indexOf(a.k)+1).padStart(2,'0')} ${CASES.find(c=>c.id===a.k)!.title}: ${signedNumber(session.receipt.ballot.answers[a.k])}`])));
 AXES.forEach(a=>{const detail=element('details');detail.append(element('summary',a.label),element('p',a.description));for(const id of[a.h,a.k]){const c=CASES.find(c=>c.id===id)!;detail.append(element('p',`${String(CASE_ORDER.indexOf(id)+1).padStart(2,'0')} ${c.title}：${signedNumber(session.receipt.ballot.answers[id])}`),element('p',c.fact));}axes.append(detail);});
 const comparison=element('div');comparison.dataset.testid='comparison';comparison.append(element('h2','提出した時点の全体と比べる','section-heading'),element('p','比較にはあなたの票を含みます。この画面と保存画像の集計は固定されます。'));const snapshot=element('div');renderSnapshot(snapshot,session.receipt.snapshot,individual.axes);comparison.append(snapshot);
 const share=element('section',undefined,'panel');container.replaceChildren(header,share,answers,axes,comparison);const stopShare=mountShare(share,session,`${location.origin}${location.pathname}`);
 return()=>{stopShare();clearResult();container.replaceChildren();};
}
