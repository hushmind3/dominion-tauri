import os from 'node:os';
import path from 'node:path';
import {WORKSPACE} from './config.mjs';

// Curated, zero-configuration MCP servers that can be installed with one click.
// Credential-based servers stay in the official Registry search flow.
export const mcpPresets = () => [
  {
    id: 'filesystem',
    name: 'Filesystem',
    package: '@modelcontextprotocol/server-filesystem',
    description: '홈 폴더의 파일을 읽고 씁니다.',
    args: [os.homedir()],
    category: '파일'
  },
  {
    id: 'git',
    name: 'Git',
    package: '@modelcontextprotocol/server-git',
    description: '작업공간 저장소의 브랜치·변경 이력·커밋을 확인합니다.',
    args: ['--repository', WORKSPACE],
    category: '개발 도구'
  },
  {
    id: 'memory',
    name: 'Memory',
    package: '@modelcontextprotocol/server-memory',
    description: '엔터티·관계·메모를 로컬 지식 그래프에 저장합니다.',
    args: [],
    category: '기억'
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    package: '@modelcontextprotocol/server-sequential-thinking',
    description: '어려운 문제를 단계별로 나눠 검토 가능한 추론으로 만듭니다.',
    args: [],
    category: '에이전트'
  },
  {
    id: 'everything',
    name: 'Everything (demo)',
    package: '@modelcontextprotocol/server-everything',
    description: '프롬프트·리소스·예제 도구를 제공하는 참조 서버입니다.',
    args: [],
    category: '개발 도구'
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    package: '@modelcontextprotocol/server-puppeteer',
    description: '로컬 크로미움 브라우저를 조작해 페이지 이동·스크린샷을 수행합니다.',
    args: [],
    category: '웹'
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    package: '@modelcontextprotocol/server-sqlite',
    description: '로컬 SQLite 데이터베이스를 조회·편집합니다.',
    args: ['--db-path', path.join(WORKSPACE, 'mcp.sqlite')],
    category: '데이터'
  }
];
