import type { Block } from '@/domain/page'
import type { I18nApi } from '@/ui/i18n/useI18n'

/** What a new page starts from, in the order the dialog offers them. */
export const TEMPLATES = [
  'blank',
  'meetingNotes',
  'decision',
  'howTo',
  'retrospective',
  'requirements'
] as const

export type Template = (typeof TEMPLATES)[number]

type Translate = I18nApi['t']

// BlockNote takes a block's text as a plain string, and fills in its id, the
// props left out and its children. A heading of the first level shows one
// level below the title of the page.
const heading = (text: string): Block => ({
  type: 'heading',
  props: { level: 1 },
  content: text
})
const paragraph = (text: string): Block => ({
  type: 'paragraph',
  content: text
})
const bullet = (text: string): Block => ({
  type: 'bulletListItem',
  content: text
})
const step = (text: string): Block => ({
  type: 'numberedListItem',
  content: text
})
const task = (text: string): Block => ({ type: 'checkListItem', content: text })

const BLOCKS: Record<Template, (t: Translate) => Block[]> = {
  blank: () => [],
  meetingNotes: t => [
    heading(t('templates.meetingNotes.attendees')),
    bullet(t('templates.meetingNotes.attendee')),
    heading(t('templates.meetingNotes.agenda')),
    step(t('templates.meetingNotes.topic')),
    heading(t('templates.meetingNotes.notes')),
    paragraph(t('templates.meetingNotes.note')),
    heading(t('templates.meetingNotes.actions')),
    task(t('templates.meetingNotes.action'))
  ],
  decision: t => [
    heading(t('templates.decision.context')),
    paragraph(t('templates.decision.contextText')),
    heading(t('templates.decision.options')),
    bullet(t('templates.decision.option')),
    heading(t('templates.decision.decision')),
    paragraph(t('templates.decision.decisionText')),
    heading(t('templates.decision.consequences')),
    paragraph(t('templates.decision.consequencesText'))
  ],
  howTo: t => [
    paragraph(t('templates.howTo.intro')),
    heading(t('templates.howTo.before')),
    bullet(t('templates.howTo.need')),
    heading(t('templates.howTo.steps')),
    step(t('templates.howTo.firstStep')),
    step(t('templates.howTo.nextStep')),
    heading(t('templates.howTo.problems')),
    paragraph(t('templates.howTo.help'))
  ],
  retrospective: t => [
    heading(t('templates.retrospective.well')),
    bullet(t('templates.retrospective.success')),
    heading(t('templates.retrospective.better')),
    bullet(t('templates.retrospective.problem')),
    heading(t('templates.retrospective.actions')),
    task(t('templates.retrospective.action'))
  ],
  requirements: t => [
    heading(t('templates.requirements.goal')),
    paragraph(t('templates.requirements.goalText')),
    heading(t('templates.requirements.requirements')),
    step(t('templates.requirements.requirement')),
    heading(t('templates.requirements.outOfScope')),
    bullet(t('templates.requirements.excluded')),
    heading(t('templates.requirements.questions')),
    bullet(t('templates.requirements.question'))
  ]
}

/** The blocks of a page made from `template`, in the person's language. */
export function blocksOf(template: Template, t: Translate): Block[] {
  return BLOCKS[template](t)
}
