export default defineAppConfig({
  ui: {
    colors: {
      primary: 'lime',
      secondary: 'violet',
      neutral: 'zinc'
    },
    button: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class: 'text-black bg-primary hover:bg-primary/75 active:bg-primary/75 disabled:bg-primary aria-disabled:bg-primary outline-primary/25 focus-visible:outline-3'
        }
      ]
    },
    tabs: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'pill',
          class: {
            indicator: 'bg-primary',
            trigger: [
              'data-[state=active]:text-black outline-primary/25 focus-visible:outline-3',
              'in-[[data-slot=list]:not(:has([data-slot=indicator]))]:data-[state=active]:before:bg-primary'
            ]
          }
        }
      ]
    }
  },
  icon: {
    mode: 'svg'
  }
})
