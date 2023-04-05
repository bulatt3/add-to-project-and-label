import { addToProject } from '../src/add-to-project'
import { expect, test } from '@jest/globals'

test('throws error when inputs are not provided', async () => {
  await expect(addToProject()).rejects.toThrow('Input required and not supplied: project-url')
})
