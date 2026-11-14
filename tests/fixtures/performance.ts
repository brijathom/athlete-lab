import { blankMatch, blankTestResult, createPerformanceData, type TestDefinition, type TestResult } from '../../src/performance-domain'

export function testRecord(patch: Partial<TestResult> = {}, definition?: TestDefinition): TestResult {
  const catalogue = createPerformanceData()
  const d = definition || catalogue.definitions.find(d => d.id === 'sprint-10')!
  const result = blankTestResult(d, '2025-04-01')
  return { ...result, id: 'test-1', savedAt: '2025-04-01T18:00:00.000Z', attempts: [1.95, 1.9], attemptCount: 2, value: 1.9, protocol: { method: 'Electronic timing gates', equipment: 'Synthetic test gates', description: d.protocol, details: { surface: 'Grass', start: 'Standing, 0.5 m offset', runIn: '', distance: '10 m', technique: '', conditions: '', foot: '', angle: '', pressure: '', recovery: '3 minutes' } }, ...patch }
}
export function matchRecord() {
  const result = blankMatch(createPerformanceData(), '2025-04-01')
  result.id = 'match-1'; result.opponent = 'Synthetic opposition'; result.position = 'Wing-back'; result.minutes = 50; result.quality = 'Recorded'; result.source = 'Match video'; result.savedAt = '2025-04-01T20:00:00.000Z'
  result.aggregate = { one: { attempts: 4, successes: 2 }, two: { attempts: 3, successes: 1 }, goal: { attempts: 1, successes: 1 } }
  result.metrics = result.metrics.map(m => ({ ...m, value: m.definition.id === 'chances' ? 2 : null }))
  result.reflections.decisions = 'Synthetic qualitative observation for automated tests.'
  return result
}
