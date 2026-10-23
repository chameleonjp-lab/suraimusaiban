import { expect, it, vi } from 'vitest';
import { cardSize } from '../../src/features/share/card';
import { shareCard } from '../../src/features/share/share-view';
it('allocates full resolution portrait cards',()=>{
 expect(cardSize('personality')).toEqual({width:1080,height:1350});
 expect(cardSize('comparison')).toEqual({width:1080,height:1350});
 expect(cardSize('verdict')).toEqual({width:1080,height:1920});
});
it('keeps the result when native sharing is cancelled',async()=>{
 vi.stubGlobal('File',class extends Blob {name='slime-trial.png';constructor(parts:BlobPart[],_name:string,options:BlobPropertyBag){super(parts,options);}});
 vi.stubGlobal('navigator',{canShare:()=>true,share:()=>Promise.reject(new DOMException('cancel','AbortError'))});
 expect(await shareCard(new Blob(['png'],{type:'image/png'}),'スライム裁判')).toBe('cancelled');vi.unstubAllGlobals();
});
it('returns the save-and-copy fallback when file sharing is unavailable',async()=>{
 vi.stubGlobal('File',class extends Blob {name='slime-trial.png';constructor(parts:BlobPart[],_name:string,options:BlobPropertyBag){super(parts,options);}});vi.stubGlobal('navigator',{});
 expect(await shareCard(new Blob(['png'],{type:'image/png'}),'スライム裁判')).toBe('fallback');vi.unstubAllGlobals();
});
