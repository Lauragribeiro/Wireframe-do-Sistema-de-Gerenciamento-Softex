import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBolsistaRecord,
  resolveStoredBolsistas,
  upsertBolsistas,
} from '../public/bolsas.js';

test('cria registro de bolsista com termo processado e adiciona na lista', () => {
  const nowDate = new Date('2024-08-01T12:00:00.000Z');
  const record = buildBolsistaRecord({
    nome: 'Maria Oliveira',
    cpfDigits: '52998224725',
    funcao: 'Pesquisadora',
    valorNum: 5000,
    termoUpload: {
      fileName: 'termo.pdf',
      parsed: {
        vigenciaISO: '2035-12-31',
        vigenciaRaw: '31/12/2035',
        valorMaximo: 9000,
        valorMaximoRaw: 'R$ 9.000,00',
      },
    },
    now: () => nowDate,
    idFactory: () => 'test-id-1',
  });

  assert.equal(record.id, 'test-id-1');
  assert.equal(record.nome, 'Maria Oliveira');
  assert.equal(record.cpf, '52998224725');
  assert.equal(record.funcao, 'Pesquisadora');
  assert.equal(record.valor, 5000);
  assert.ok(record.termo);
  assert.equal(record.termo.fileName, 'termo.pdf');
  assert.equal(record.termo.vigenciaISO, '2035-12-31');
  assert.equal(record.termo.valorMaximo, 9000);
  assert.equal(record.atualizadoEm, nowDate.toISOString());
  assert.equal(record.termo.parsedAt, nowDate.toISOString());
  assert.deepEqual(record.historicoAlteracoes, []);

  const listaAtualizada = upsertBolsistas([], record, null);
  assert.equal(listaAtualizada.length, 1);
  assert.deepEqual(listaAtualizada[0], record);
});

test('registra histórico ao atualizar função e valor do bolsista', () => {
  const createdAt = new Date('2024-08-01T12:00:00.000Z');
  const updatedAt = new Date('2024-08-05T08:30:00.000Z');

  const original = buildBolsistaRecord({
    nome: 'Maria Oliveira',
    cpfDigits: '52998224725',
    funcao: 'Pesquisadora',
    valorNum: 5000,
    termoUpload: null,
    now: () => createdAt,
    idFactory: () => 'test-id-1',
  });

  const atualizado = buildBolsistaRecord({
    editingId: 'test-id-1',
    nome: 'Maria Oliveira',
    cpfDigits: '52998224725',
    funcao: 'Analista de Dados',
    valorNum: 6200,
    termoUpload: null,
    fallbackTermo: original.termo,
    now: () => updatedAt,
    idFactory: () => 'test-id-1',
    existingRecord: original,
  });

  assert.equal(atualizado.historicoAlteracoes.length, 2);
  assert.deepEqual(atualizado.historicoAlteracoes[0], {
    campo: 'funcao',
    anterior: 'Pesquisadora',
    atual: 'Analista de Dados',
    modificadoEm: updatedAt.toISOString(),
  });
  assert.deepEqual(atualizado.historicoAlteracoes[1], {
    campo: 'valor',
    anterior: 5000,
    atual: 6200,
    modificadoEm: updatedAt.toISOString(),
  });
});

test('mantém bolsista recém cadastrado quando armazenamento local ainda não possui dados', () => {
  const previous = [{
    id: 'temp-1',
    nome: 'João Silva',
    cpf: '12345678901',
    funcao: 'Analista',
    valor: 2500,
    termo: { fileName: 'termo-temp.pdf' },
  }];

  const resultado = resolveStoredBolsistas({
    previous,
    stored: null,
    projectId: '42',
  });

  assert.deepEqual(resultado.list, previous);
  assert.equal(resultado.shouldPersist, true);
});

test('prioriza dados já salvos quando encontrados no armazenamento', () => {
  const previous = [{ id: 'temp-1' }];
  const stored = [{
    id: 'persistido-1',
    nome: 'Ana',
    cpf: '98765432100',
    funcao: 'Coordenadora',
    valor: 3200,
  }];

  const resultado = resolveStoredBolsistas({
    previous,
    stored,
    projectId: '42',
  });

  assert.deepEqual(resultado.list, stored);
  assert.equal(resultado.shouldPersist, false);
});
