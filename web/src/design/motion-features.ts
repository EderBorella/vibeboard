// THE FEATURE BUNDLE, IN ITS OWN MODULE SO VITE CAN SPLIT IT OUT.
//
// `LazyMotion features={domAnimation}` with a STATIC import buys nothing: the feature set lands in
// the entry chunk exactly as `motion.*` would, and the component is then lazy in name only. The
// deferral only happens when `features` is a function returning a dynamic `import()`, because that is
// what gives the bundler a split point. This file exists to be that split point and holds nothing else.
//
// `domAnimation` and not `domMax`: animation, variants, exit and gestures, without drag or layout
// projection, which roughly halves it. Nothing in this app drags or projects. A call site that needs
// `domMax` should change this deliberately and record what it cost.
export { domAnimation as default } from 'motion/react';
