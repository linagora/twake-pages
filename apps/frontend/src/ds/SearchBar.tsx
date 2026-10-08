import { SearchBar as TwakeSearchBar, styled } from '@linagora/twake-mui'

// twake-mui's SearchBar bakes in the light palette; the theme's CSS variables
// follow a color scheme switched at runtime.
export const SearchBar = styled(TwakeSearchBar)(({ theme }) => ({
  '&&': {
    backgroundColor: theme.vars.palette.background.default,
    '&.SearchBar-focused': {
      backgroundColor: theme.vars.palette.background.paper,
      borderColor: theme.vars.palette.primary.main
    }
  },
  '& .SearchBar-icon': { color: theme.vars.palette.text.secondary },
  '& .SearchBar-focusHighlight': {
    backgroundColor: theme.vars.palette.action.hover
  }
}))
