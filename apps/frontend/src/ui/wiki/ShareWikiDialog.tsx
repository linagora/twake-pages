import { Check, Cross, Icon } from '@linagora/twake-icons'
import {
  Autocomplete,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
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

import { InviteRow, PersonRow } from '@/ds/PeopleList'
import { ROLES, type Role, type Wiki } from '@/domain/wiki'
import { useI18n } from '@/ui/i18n/useI18n'
import { PersonAvatar } from '@/ui/people/PersonAvatar'
import { useSharing, useSharingChange } from '@/ui/wiki/queries'
import { useWikiName } from '@/ui/wiki/useWikiName'

function RoleMenu({
  value,
  onChange
}: {
  value: Role
  onChange?: (role: Role) => void
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
      </Menu>
    </>
  )
}

/** Who has access to a wiki, and how its admin shares it, by email. */
export function ShareWikiDialog({
  wiki,
  onClose
}: {
  wiki: Wiki
  onClose: () => void
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const wikiName = useWikiName()
  const sharing = useSharing(wiki.id)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [invited, setInvited] = useState<string | null>(null)
  const change = useSharingChange(wiki.id)

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId}>
      <DialogTitle
        id={titleId}
        className="u-flex u-flex-items-center u-flex-justify-between"
      >
        <span className="u-ellipsis">
          {t('sharing.title', { name: wikiName(wiki) })}
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
          <Autocomplete
            freeSolo
            options={[]}
            inputValue={email}
            onInputChange={(_event, value) => {
              setEmail(value)
            }}
            renderInput={params => (
              <TextField
                {...params}
                label={t('sharing.email')}
                type="email"
                size="small"
                slotProps={{
                  ...params.slotProps,
                  htmlInput: { ...params.slotProps.htmlInput, maxLength: 254 }
                }}
              />
            )}
          />
          <RoleMenu value={role} onChange={setRole} />
          <Button type="submit" disabled={change.isPending || !email.trim()}>
            {t('sharing.invite')}
          </Button>
        </InviteRow>
        {invited && (
          <Typography role="status" variant="body2" className="u-mt-1">
            {t('sharing.invited', { email: invited })}
          </Typography>
        )}
        <Typography variant="subtitle2" className="u-mt-1-half">
          {t('sharing.people')}
        </Typography>
        <List dense>
          {sharing.data?.invites.map(invitation => (
            <PersonRow
              key={invitation.id}
              label={invitation.email}
              avatar={<PersonAvatar email={invitation.email} size={32} />}
            >
              {/* Unlike Twake Tasks' "Pending": the word the domain gives it. */}
              <Chip size="small" label={t('sharing.invitation')} />
              <RoleMenu value={invitation.role} />
            </PersonRow>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  )
}
