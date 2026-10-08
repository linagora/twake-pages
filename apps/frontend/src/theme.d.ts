import '@mui/material/styles'

// The twake-mui theme switches light and dark through CSS variables, so
// `theme.palette` holds the light colours only: styles read `theme.vars`.
declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true
  }
}
