import * as d3 from 'd3'
import fetch from 'node-fetch'
import fs from 'fs'
import path from 'path'
import urljoin from 'url-join'
import { config } from 'process'

const ANNOTATION_FILES_BASE_PATH = 'https://raw.githubusercontent.com/satijalab/azimuth_website/master/static/csv/'
const MASTER_TABLE_BASE_PATH = 'https://docs.google.com/spreadsheets/d/1tK916JyG5ZSXW_cXfsyZnzXfjyoN-8B2GXLbYD6_vF0/gviz/tq?tqx=out:csv'
const OUTPUT_DIR = 'output'

if (!fs.existsSync(OUTPUT_DIR)){
  fs.mkdirSync(OUTPUT_DIR);
}

const CTMatchType = {
  ID: 'ID',
  Name: 'Name'
}

const configs = [
  {
    name: 'Kidney',
    annotations: [
      'kidney_l1',
      'kidney_l2',
      'kidney_l3'
    ],
    masterTable: 'Kidney_v1.1_DRAFT',
    matchType: CTMatchType.ID
  },
  {
    name: 'Brain',
    annotations: [
      'humanbrain_class',
      'humanbrain_cluster',
      'humanbrain_crossspecies',
      'humanbrain_subclass'
    ],
    masterTable: 'Brain_v1.1_DRAFT',
    matchType: CTMatchType.Name
  },
  {
    name: 'Lung',
    annotations: [
      'lung_l1',
      'lung_l2'
    ],
    masterTable: 'Lung_v1.1_DRAFT',
    matchType: CTMatchType.ID
  },
  {
    name: 'Pancreas',
    annotations: [
      'pancreas'
    ],
    masterTable: 'Pancreas_v1.0_DRAFT',
    matchType: CTMatchType.ID
  },
  {
    name: 'Bone_Marrow_Blood',
    annotations: [
      'pbmc1',
      'pbmc2',
      'pbmc3',
      'bonemarrow_l1',
      'bonemarrow_l2'
    ],
    masterTable: 'Bone Marrow_Blood_v1.1_DRAFT',
    matchType: CTMatchType.ID
  }
]
const summaryList = []

for (const { name, annotations, masterTable, matchType } of configs) {
  // Create annotation map
  const annotationMap = new Map()
  for (const file of annotations) {
    const textData = await (await fetch(urljoin(ANNOTATION_FILES_BASE_PATH, `${file}.csv`))).text()
    if (!textData) {
      console.error('Could not fetch annotation files for ' + name)
      continue
    }
    const csvData = d3.csvParse(textData);
    csvData.forEach(row => {
      const match = /\[.*\]\(.*(CL_[0-9]+)\)/.exec(row['OBO Ontology ID'])
      switch (matchType) {
      case CTMatchType.ID:
        if (match) annotationMap.set(match[1].replace('_', ':'), row['Label'])
        break
      case CTMatchType.Name:
        annotationMap.set(row['Label'], match ? match[1].replace('_', ':') : '')
      }
    })
  }

  // Search master table for CTs
  const originalSize = annotationMap.size
  let commonValues = 0
  const asctbText = await (await fetch(urljoin(MASTER_TABLE_BASE_PATH, `&sheet=${masterTable}`))).text()
  const splitLines = asctbText.split('\n')
  const startIndex = splitLines.findIndex(line => /^"?AS\/[0-9]+/.test(line))
  const asctbCsv = d3.csvParse(splitLines.slice(startIndex !== -1 ? startIndex : 10).join('\n'))
  asctbCsv.forEach(row => {
    const identifiers = (() => {
      switch (matchType) {
      case CTMatchType.ID: return [row['CT/1/ID']]
      case CTMatchType.Name: return [row['CT/1'], row['CT/1/Label']]
      }
    })()
    for (const key of identifiers) {
      if (!key) continue
      if (annotationMap.delete(key)) {
        commonValues++
        break
      }
    }

  })

  // Create summary data
  console.log(`${commonValues} values found for ${name}`)
  summaryList.push({
    'Dataset': name,
    'Azimuth Annotation Files': annotations.join(', '),
    'ASCT+B Table': masterTable,
    'Present in ASCT+B': commonValues,
    'Absent in ASCT+B': originalSize - commonValues,
    'Total Azimuth CTs': originalSize,
    'Match Strategy': matchType
  })

  // Write filtered annotation file
  const filteredAnnotations = d3.csvFormat(
    Array.from(annotationMap)
      .sort(([key1], [key2]) => key1.localeCompare(key2))
      .map(([key, value]) => {
        const { label, ontologyId } = (() => {
          switch (matchType) {
            case CTMatchType.ID: return { label: value, ontologyId: key }
            case CTMatchType.Name: return { label: key, ontologyId: value }
            }
        })()
        return {
          'Label': label,
          'Ontology ID': ontologyId
        }
      })
  );
  
  fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.csv`), filteredAnnotations, { encoding: 'utf-8', flag: 'w' })
}

// Write summary file
const summaryCsv = d3.csvFormat(
  Array.from(summaryList)
    .sort((s1, s2) => s1['Dataset'].localeCompare(s2['Dataset']))
)

fs.writeFileSync(path.join(OUTPUT_DIR, 'Summary.csv'), summaryCsv, { encoding: 'utf-8', flag: 'w' })