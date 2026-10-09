import { Check, Cross, Icon } from '@linagora/twake-icons'
import {
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  DropdownButton,
  IconButton,
  List,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  TextField,
  Typography
} from '@linagora/twake-mui'
import { useId, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'

import { ApiError } from '@/application/pages'
import { InviteRow, PersonRow } from '@/ds/PeopleList'
import { displayName } from '@/domain/person'
import { ROLES, type Role, type Wiki } from '@/domain/wiki'
import { useI18n, type TranslationKey } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import {
  usePeopleMatching,
  useRemoveMember,
  useSharing,
  useSharingChange
} from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

// Unlike Twake Tasks, which says only that the change failed: these two the
// admin meets in plain use, and can do something about.
const REFUSALS: Partial<Record<string, TranslationKey>> = {
  last_admin: 'sharing.lastAdmin',
  not_same_organization: 'sharing.notSameOrganization'
}

/** Why the last change of the members was not made. */
function SharingFailure({ error }: { error: Error }): ReactElement {
  const { t } = useI18n()
  const refused = error instanceof ApiError ? error.code : null
  return (
    <Typography role="alert" color="error" className="u-mt-1">
      {t(
        (refused === null ? undefined : REFUSALS[refused]) ?? 'sharing.failed'
      )}
    </Typography>
  )
}

function RoleMenu({
  value,
  onChange,
  action
}: {
  value: Role
  onChange?: (role: Role) => void
  action?: { label: string; run: () => void }
}): ReactElement {
  const { t } = useI18n()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = (): void => {
    setAnchor(null)
  }
  const label = t(`sharing.roles.${value}`)

  return (
    <>
      <DropdownButton
        textVariant="body2"
        aria-label={t('sharing.roleOf', { role: label })}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={event => {
          setAnchor(event.currentTarget)
        }}
      >
        {label}
      </DropdownButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {onChange &&
          ROLES.map(role => (
            <MenuItem
              key={role}
              selected={role === value}
              onClick={() => {
                close()
                if (role !== value) onChange(role)
              }}
            >
              <ListItemIcon>
                {role === value && <Icon icon={Check} />}
              </ListItemIcon>
              <ListItemText>{t(`sharing.roles.${role}`)}</ListItemText>
            </MenuItem>
          ))}
        {onChange && action && <Divider />}
        {action && (
          <MenuItem
            onClick={() => {
              close()
              action.run()
            }}
          >
            <ListItemText className="u-error">{action.label}</ListItemText>
          </MenuItem>
        )}
      </Menu>
    </>
  )
}

/**
 * The email to invite, with the people of the organization it may be as
 * suggestions: none in B2C, where an email is typed whole.
 */
function EmailField({
  value,
  onChange
}: {
  value: string
  onChange: (email: string) => void
}): ReactElement {
  const { t } = useI18n()
  const people = usePeopleMatching(value)

  return (
    <Autocomplete
      freeSolo
      options={value.trim() === '' ? [] : (people.data ?? [])}
      // The backend finds them by name too, which the email shown lacks.
      filterOptions={options => options}
      getOptionLabel={option =>
        typeof option === 'string' ? option : option.email
      }
      renderOption={({ key, ...props }, person) => (
        <li key={key} {...props}>
          <ListItemText
            primary={displayName(person)}
            secondary={
              displayName(person) === person.email ? undefined : person.email
            }
          />
        </li>
      )}
      inputValue={value}
      onInputChange={(_event, typed) => {
        onChange(typed)
      }}
      renderInput={params => (
        <TextField
          {...params}
          label={t('sharing.email')}
          type="email"
          size="small"
          helperText={
            people.isError ? t('sharing.suggestionsFailed') : undefined
          }
          slotProps={{
            ...params.slotProps,
            htmlInput: { ...params.slotProps.htmlInput, maxLength: 254 }
          }}
        />
      )}
    />
  )
}

/**
 * Who has access to a wiki, and how its admin shares it, by email. Unlike
 * Twake Tasks, which lists the members to the others in a dialog of its own,
 * the others see this one `readOnly`, from the same list: each role shows as
 * text, to tell them whom to ask for a change.
 */
export function ShareWikiDialog({
  wiki,
  readOnly,
  onClose
}: {
  wiki: Wiki
  readOnly: boolean
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const wikiName = useWikiName()
  const sharing = useSharing(wiki.id)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [invited, setInvited] = useState<string | null>(null)
  const navigate = useNavigate()
  const change = useSharingChange(wiki.id)
  const remove = useRemoveMember(wiki.id, () => {
    void navigate('/')
  })
  // The dialog tells why the last change asked failed, whichever it was.
  const failure =
    remove.submittedAt > change.submittedAt ? remove.error : change.error

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle
        id={titleId}
        className="u-flex u-flex-items-center u-flex-justify-between"
      >
        <span className="u-ellipsis">
          {readOnly
            ? t('sharing.people')
            : t('sharing.title', { name: wikiName(wiki) })}
        </span>
        <IconButton
          aria-label={t('sharing.close')}
          onClick={onClose}
          className="u-ml-half"
        >
          <Icon icon={Cross} />
        </IconButton>
      </DialogTitle>
      <DialogContent className="u-pb-1-half">
        {!readOnly && (
          <InviteRow
            label={t('sharing.invite')}
            onSubmit={() => {
              const to = email.trim().toLowerCase()
              change.mutate(api => api.invite(wiki.id, to, role), {
                onSuccess: () => {
                  setInvited(to)
                  setEmail('')
                }
              })
            }}
          >
            <EmailField value={email} onChange={setEmail} />
            <RoleMenu value={role} onChange={setRole} />
            <Button type="submit" disabled={change.isPending || !email.trim()}>
              {t('sharing.invite')}
            </Button>
          </InviteRow>
        )}
        {invited && (
          <Typography role="status" variant="body2" className="u-mt-1">
            {t('sharing.invited', { email: invited })}
          </Typography>
        )}
        {failure && <SharingFailure error={failure} />}
        {sharing.isError && (
          <Typography role="alert" color="error" className="u-mt-1">
            {t('sharing.loadFailed')}
          </Typography>
        )}
        {wiki.kind === 'space' && (
          <Typography variant="body2" color="textSecondary">
            {t('sharing.fromSpace')}
          </Typography>
        )}
        {!readOnly && (
          <Typography variant="subtitle2" className="u-mt-1-half">
            {t('sharing.people')}
          </Typography>
        )}
        <List dense>
          {sharing.data?.members.map(member => (
            <PersonRow
              key={member.id}
              label={displayName(member)}
              detail={
                displayName(member) === member.email ? undefined : member.email
              }
              avatar={
                <PersonAvatar
                  email={member.email}
                  name={member.name}
                  size={32}
                />
              }
            >
              {readOnly ? (
                <Typography variant="body2" color="textSecondary">
                  {t(`sharing.roles.${member.role}`)}
                </Typography>
              ) : (
                <RoleMenu
                  value={member.role}
                  onChange={next => {
                    change.mutate(api =>
                      api.setMemberRole(wiki.id, member.id, next)
                    )
                  }}
                  action={{
                    label: t('sharing.remove'),
                    run: () => {
                      remove.mutate(member)
                    }
                  }}
                />
              )}
            </PersonRow>
          ))}
          {/*
            The backend sends the invitations to admins only, but those read
            while the person was its admin stay until the members are read
            again.
          */}
          {!readOnly &&
            sharing.data?.invites.map(invitation => (
              <PersonRow
                key={invitation.id}
                label={invitation.email}
                avatar={<PersonAvatar email={invitation.email} size={32} />}
              >
                {/* Unlike Twake Tasks' "Pending": the word the domain gives it. */}
                <Chip size="small" label={t('sharing.invitation')} />
                <RoleMenu
                  value={invitation.role}
                  action={{
                    label: t('sharing.cancelInvitation'),
                    run: () => {
                      change.mutate(api =>
                        api.cancelInvite(wiki.id, invitation.id)
                      )
                    }
                  }}
                />
              </PersonRow>
            ))}
        </List>
      </DialogContent>
    </Dialog>
  )
}
