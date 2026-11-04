import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldPlan} from '../server/native-intent.mjs';
test('ordinary questions and single tool actions use the direct runtime',()=>{
 assert.equal(shouldPlan('안녕하세요?'),false);
 assert.equal(shouldPlan('작업공간에 note.txt 파일 만들어줘'),false);
 assert.equal(shouldPlan('이 코드는 어떤 역할이야?'),false);
});
test('multi-stage native execution requests trigger planning without /goal',()=>{
 assert.equal(shouldPlan('새 플랫폼 프로젝트를 설계하고 구현한 다음 테스트하고 배포해줘'),true);
 assert.equal(shouldPlan('Build and test the entire website project, then deploy it'),true);
});
