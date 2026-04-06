#!/usr/bin/env node
/**
 * Menu bar extra icon (macOS): Apple Standard.
 * Generates exact physical pixels for 1x, 2x (Retina), and 3x displays.
 * Electron's nativeImage automatically resolves the @2x/@3x suffixes for sharp rendering.
 *
 * Source: menubar/tray-menu-template.svg
 * Output: menubar/IconTemplate.png (18x18), @2x (36x36), @3x (54x54)
 *
 * Run: npm run icons:menubar
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const svgPath = path.join(root, 'menubar', 'tray-menu-template.svg')

const svg = fs.readFileSync(svgPath)

// 1x display (18x18 pixels)
const resvg1x = new Resvg(svg, { fitTo: { mode: 'width', value: 18 }, background: 'transparent' })
fs.writeFileSync(path.join(root, 'menubar', 'IconTemplate.png'), resvg1x.render().asPng())

// 2x Retina display (36x36 pixels)
const resvg2x = new Resvg(svg, { fitTo: { mode: 'width', value: 36 }, background: 'transparent' })
fs.writeFileSync(path.join(root, 'menubar', 'IconTemplate@2x.png'), resvg2x.render().asPng())

// 3x Super Retina display (54x54 pixels)
const resvg3x = new Resvg(svg, { fitTo: { mode: 'width', value: 54 }, background: 'transparent' })
fs.writeFileSync(path.join(root, 'menubar', 'IconTemplate@3x.png'), resvg3x.render().asPng())

console.log('Wrote Apple Standard IconTemplate pngs (1x, 2x, 3x)')
