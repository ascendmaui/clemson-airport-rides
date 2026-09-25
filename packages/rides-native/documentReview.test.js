import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LICENSE_REVIEW_STATUS,
  extractReadableText,
  licensePendingCopy,
  matchRegistration,
  reviewLicenseImage,
} from './documentReview.js'

test('LICENSE_REVIEW_STATUS constant', () => {
  assert.equal(typeof LICENSE_REVIEW_STATUS, 'string')
  assert.equal(LICENSE_REVIEW_STATUS, 'pending_manual_review')
})

test('a readable license photo is pending manual review and is not approved', () => {
  const review = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 80_000,
    width: 1200,
    height: 800,
    text: 'DRIVER LICENSE CLASS EXP DOB',
  })
  assert.equal(review.ok, true)
  assert.equal(review.approved, false)
  assert.equal(review.reviewStatus, 'pending_manual_review')
  assert.equal(review.message, 'Received. Pending manual review. This upload is not approved.')
  assert.match(licensePendingCopy('license_front'), /pending manual review/i)
  assert.match(licensePendingCopy('license_back'), /pending manual review/i)
})

test('reviewLicenseImage input handling and null safety', () => {
  // BUG?: reviewLicenseImage(null) throws TypeError because default argument only applies to undefined
  assert.throws(() => reviewLicenseImage(null), TypeError)

  // Empty options object or undefined argument fails on missing mimeType
  const noArgs = reviewLicenseImage()
  assert.equal(noArgs.ok, false)
  assert.equal(noArgs.approved, false)
  assert.equal(noArgs.reviewStatus, null)
  assert.equal(noArgs.message, 'Upload a photo of the license. PDF and other files are not accepted for the license.')

  const emptyObj = reviewLicenseImage({})
  assert.equal(emptyObj.ok, false)
  assert.equal(emptyObj.reviewStatus, null)

  // BUG?: reviewLicenseImage with only mimeType skips all size, dimension, and keyword checks and passes
  const mimeOnly = reviewLicenseImage({ mimeType: 'image/jpeg' })
  assert.equal(mimeOnly.ok, true)
  assert.equal(mimeOnly.approved, false)
  assert.equal(mimeOnly.reviewStatus, 'pending_manual_review')
})

test('reviewLicenseImage mimeType validation', () => {
  // Accepted image MIME types (case insensitive)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000 }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'IMAGE/PNG', size: 50_000 }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/heic', size: 50_000 }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/webp', size: 50_000 }).ok, true)

  // Rejected non-image MIME types
  const rejected = ['application/pdf', 'text/plain', 'image', '', null, undefined, 'application/octet-stream']
  for (const mimeType of rejected) {
    const res = reviewLicenseImage({ mimeType, size: 50_000 })
    assert.equal(res.ok, false)
    assert.equal(res.approved, false)
    assert.equal(res.reviewStatus, null)
    assert.equal(res.message, 'Upload a photo of the license. PDF and other files are not accepted for the license.')
  }
})

test('reviewLicenseImage file size boundaries', () => {
  // Missing / empty size skips size checks
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: null }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: undefined }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: '' }).ok, true)

  // Lower bound (< 12_000 bytes)
  const tooSmall = reviewLicenseImage({ mimeType: 'image/jpeg', size: 11_999 })
  assert.equal(tooSmall.ok, false)
  assert.equal(tooSmall.message, 'That image is too small or looks blank. Retake the photo so the full license fills the frame.')

  const atLowerBound = reviewLicenseImage({ mimeType: 'image/jpeg', size: 12_000 })
  assert.equal(atLowerBound.ok, true)

  // Zero, negative, and NaN sizes
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 0 }).ok, false)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: -100 }).ok, false)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 'invalid' }).ok, false)

  // String numeric sizes coerced
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: '11999' }).ok, false)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: '12000' }).ok, true)

  // Upper bound (> 8MB = 8 * 1024 * 1024 = 8,388,608 bytes)
  const atUpperBound = reviewLicenseImage({ mimeType: 'image/jpeg', size: 8 * 1024 * 1024 })
  assert.equal(atUpperBound.ok, true)

  const tooLarge = reviewLicenseImage({ mimeType: 'image/jpeg', size: 8 * 1024 * 1024 + 1 })
  assert.equal(tooLarge.ok, false)
  assert.equal(tooLarge.message, 'Each photo must be 8MB or smaller.')

  const muchTooLarge = reviewLicenseImage({ mimeType: 'image/jpeg', size: 15_000_000 })
  assert.equal(muchTooLarge.ok, false)
  assert.equal(muchTooLarge.message, 'Each photo must be 8MB or smaller.')
})

test('reviewLicenseImage dimension boundaries and aspect ratio', () => {
  // BUG?: if width is provided (e.g. 100) but height is omitted or 0, dimension and aspect ratio checks are skipped entirely
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 100 }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, height: 100 }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 0, height: 0 }).ok, true)

  // Minimum dimensions: w >= 480 and h >= 320
  const widthTooSmall = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 479, height: 320 })
  assert.equal(widthTooSmall.ok, false)
  assert.equal(widthTooSmall.message, 'That photo is too small to read. Move closer so the license is sharp.')

  const heightTooSmall = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 480, height: 319 })
  assert.equal(heightTooSmall.ok, false)
  assert.equal(heightTooSmall.message, 'That photo is too small to read. Move closer so the license is sharp.')

  const atMinDimensions = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 480, height: 320 })
  assert.equal(atMinDimensions.ok, true)

  // Aspect ratio: w/h > 4 or h/w > 4 fails
  // Width-dominant aspect ratio
  const ratioAtLimitW = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 1600, height: 400 })
  assert.equal(ratioAtLimitW.ok, true)

  const ratioTooWide = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 1601, height: 400 })
  assert.equal(ratioTooWide.ok, false)
  assert.equal(ratioTooWide.message, 'Frame the whole license. This photo is too narrow to be a license.')

  // Height-dominant aspect ratio (w must be at least 480 to satisfy minimum dimensions)
  const ratioAtLimitH = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 480, height: 1920 })
  assert.equal(ratioAtLimitH.ok, true)

  const ratioTooTall = reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, width: 480, height: 1921 })
  assert.equal(ratioTooTall.ok, false)
  assert.equal(ratioTooTall.message, 'Frame the whole license. This photo is too narrow to be a license.')
})

test('reviewLicenseImage text keyword checks', () => {
  // Empty, null, or whitespace text skips keyword check
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, text: null }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, text: undefined }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, text: '' }).ok, true)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 50_000, text: '   \n\t  ' }).ok, true)

  // Text with 0 keywords fails
  const noKeywords = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'Random store receipt total $42.50 items included',
  })
  assert.equal(noKeywords.ok, false)
  assert.equal(noKeywords.message, 'This photo does not look like a driver license. Include the full card with the license wording visible.')

  // Text with only 1 keyword fails
  const oneKeyword = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'Standard Driver certification card',
  })
  assert.equal(oneKeyword.ok, false)
  assert.equal(oneKeyword.message, 'This photo does not look like a driver license. Include the full card with the license wording visible.')

  // Repeated single keyword still counts as 1 hit and fails
  const repeatedKeyword = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'driver driver driver driver',
  })
  assert.equal(repeatedKeyword.ok, false)

  // 2 distinct keywords passes
  const twoKeywords = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'SOUTH CAROLINA DRIVER LICENSE',
  })
  assert.equal(twoKeywords.ok, true)

  const otherTwoKeywords = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'DOB 01/01/2000 EXP 01/01/2030',
  })
  assert.equal(otherTwoKeywords.ok, true)

  // All 6 keywords present
  const allKeywords = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'driver license class c dob 1999 exp 2029 dl #12345678',
  })
  assert.equal(allKeywords.ok, true)

  // BUG?: LICENSE_KEYWORDS matching uses substring includes without word boundaries, so "idle expensive" matches "dl" and "exp"
  const substringMatch = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 50_000,
    text: 'idle expensive',
  })
  assert.equal(substringMatch.ok, true)
})

test('licensePendingCopy returns expected copy by docType', () => {
  assert.equal(licensePendingCopy('license_back'), 'License back received. It is pending manual review.')
  assert.equal(licensePendingCopy('license_front'), 'License front received. It is pending manual review.')

  // BUG?: licensePendingCopy returns front copy for null, undefined, or unexpected docType instead of throwing or falling back to generic copy
  assert.equal(licensePendingCopy(undefined), 'License front received. It is pending manual review.')
  assert.equal(licensePendingCopy(null), 'License front received. It is pending manual review.')
  assert.equal(licensePendingCopy(''), 'License front received. It is pending manual review.')
  assert.equal(licensePendingCopy('insurance_card'), 'License front received. It is pending manual review.')
})

test('extractReadableText handles empty, null, and non-string inputs', () => {
  assert.equal(extractReadableText(), '')
  assert.equal(extractReadableText(null), '')
  assert.equal(extractReadableText(undefined), '')
  assert.equal(extractReadableText(''), '')
  assert.equal(extractReadableText('   '), '')
  assert.equal(extractReadableText('a!b!c'), '') // tokens separated by invalid chars shorter than 4 chars

  // BUG?: extractReadableText regex allows spaces inside character runs, so 'a bb ccc' matches as a single run
  assert.equal(extractReadableText('a bb ccc'), 'a bb ccc')
})

test('extractReadableText extracts runs of 4 or more readable characters', () => {
  assert.equal(extractReadableText('abcd'), 'abcd')
  assert.equal(extractReadableText('1234'), '1234')
  assert.equal(extractReadableText('  South   Carolina   Registration  2026  '), 'South Carolina Registration 2026')

  // Punctuation and symbols inside runs
  const textWithPunct = 'Plate #ABC-123. Exp. 12/28, VIN: 1HGCR2F83HA123456'
  const extracted = extractReadableText(textWithPunct)
  assert.match(extracted, /ABC-123/)
  assert.match(extracted, /1HGCR2F83HA123456/)

  // Leading non-alphanumeric punctuation skipped until alphanumeric
  assert.equal(extractReadableText('...test-run'), 'test-run')

  // BUG?: extractReadableText treats binary as Latin-1 and regex only matches ASCII [A-Za-z0-9], stripping non-ASCII characters and breaking accented words
  assert.equal(extractReadableText('Café Münch'), '')

  // BUG?: extractReadableText regex includes hyphen - but excludes underscore _, splitting snake_case identifiers
  assert.equal(extractReadableText('SOME_IDENTIFIER_NAME'), 'SOME IDENTIFIER NAME')
})

test('extractReadableText handles Uint8Array and Buffer inputs across chunk boundaries', () => {
  // Uint8Array with ASCII text
  const bytes = new TextEncoder().encode('South Carolina Department of Motor Vehicles Registration 2026')
  assert.equal(extractReadableText(bytes), 'South Carolina Department of Motor Vehicles Registration 2026')

  // Embedded text separated by binary zeroes / non-text
  const binaryPayload = new Uint8Array([
    0x00, 0x01, 0x02,
    0x48, 0x6f, 0x6e, 0x64, 0x61, // 'Honda'
    0x00, 0xff,
    0x43, 0x69, 0x76, 0x69, 0x63, // 'Civic'
    0x00, 0x03,
  ])
  assert.equal(extractReadableText(binaryPayload), 'Honda Civic')

  // ArrayBuffer input
  const buffer = bytes.buffer
  assert.equal(extractReadableText(buffer), 'South Carolina Department of Motor Vehicles Registration 2026')

  // Uint8Array exceeding 4096-byte chunk size
  const largeArray = new Uint8Array(9000)
  const pattern1 = new TextEncoder().encode('STARTING-PATTERN-HEADER')
  largeArray.set(pattern1, 100)
  // Text crossing chunk boundary (4096)
  const pattern2 = new TextEncoder().encode('ACROSS-4096-CHUNK-BOUNDARY-VALID')
  largeArray.set(pattern2, 4090)
  const pattern3 = new TextEncoder().encode('ENDING-PATTERN-FOOTER')
  largeArray.set(pattern3, 8500)

  const largeExtracted = extractReadableText(largeArray)
  assert.match(largeExtracted, /STARTING-PATTERN-HEADER/)
  assert.match(largeExtracted, /ACROSS-4096-CHUNK-BOUNDARY-VALID/)
  assert.match(largeExtracted, /ENDING-PATTERN-FOOTER/)
})

test('matchRegistration unreadable inputs and null safety', () => {
  // BUG?: matchRegistration(null) throws TypeError because default argument only applies to undefined
  assert.throws(() => matchRegistration(null), TypeError)

  // Empty or missing arguments return unreadable
  const emptyRes = matchRegistration()
  assert.equal(emptyRes.status, 'unreadable')
  assert.equal(emptyRes.matched, false)
  assert.equal(emptyRes.reviewStatus, 'needs_review')
  assert.equal(emptyRes.message, 'We could not read the registration. Upload a clearer photo or the PDF, or correct the vehicle details and try again.')

  // Text too short (< 8 chars)
  assert.equal(matchRegistration({ text: '' }).status, 'unreadable')
  assert.equal(matchRegistration({ text: '1234567' }).status, 'unreadable')
  assert.equal(matchRegistration({ text: '        ' }).status, 'unreadable') // trimmed to 0 chars
  assert.equal(matchRegistration({ text: null }).status, 'unreadable')
  assert.equal(matchRegistration({ text: undefined }).status, 'unreadable')
})

test('matchRegistration make matching, canonical aliases, and quirks', () => {
  // Aliases for Chevrolet: chevy -> chevrolet
  const chevyMatched = matchRegistration({
    text: 'State of South Carolina Chevrolet Camaro gray plate ABC1234',
    make: 'Chevy',
  })
  assert.equal(chevyMatched.status, 'matched')
  assert.equal(chevyMatched.matched, true)

  const chevroletMatched = matchRegistration({
    text: 'State of South Carolina Chevrolet Camaro gray plate ABC1234',
    make: 'Chevrolet',
  })
  assert.equal(chevroletMatched.status, 'matched')

  // Reverse aliases: driver entering 'Chevrolet' against document containing 'Chevy' matches
  const chevyInDocMatched = matchRegistration({
    text: 'State of South Carolina Chevy Camaro gray plate ABC1234',
    make: 'Chevrolet',
    model: 'Camaro',
    color: 'Gray',
    plate: 'ABC1234',
  })
  assert.equal(chevyInDocMatched.status, 'matched')
  assert.equal(chevyInDocMatched.matched, true)

  // Driver entering canonical make matches document containing abbreviations
  assert.equal(matchRegistration({ text: 'Registration card VW Jetta', make: 'Volkswagen' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Mercedes C300', make: 'Mercedes-Benz' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Benz C300', make: 'Mercedes-Benz' }).status, 'matched')

  // Volkswagen aliases: vw, volkswagon, volkswagen
  assert.equal(matchRegistration({ text: 'Registration card Volkswagen Jetta', make: 'vw' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Volkswagen Jetta', make: 'volkswagon' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Volkswagen Jetta', make: 'volkswagen' }).status, 'matched')

  // Mercedes-Benz aliases: mercedes, mercedes-benz, benz
  assert.equal(matchRegistration({ text: 'Registration card Mercedes-Benz C300', make: 'mercedes' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Mercedes-Benz C300', make: 'mercedes-benz' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Mercedes-Benz C300', make: 'benz' }).status, 'matched')

  // BMW alias
  assert.equal(matchRegistration({ text: 'Registration card BMW 330i', make: 'BMW' }).status, 'matched')

  // Standard non-aliased make (folded comparison)
  assert.equal(matchRegistration({ text: 'Registration card Subaru Outback', make: 'Subaru' }).status, 'matched')

  // Make 'other' or 'Other' is exempt
  assert.equal(matchRegistration({ text: 'Registration card Unknown Vehicle', make: 'other' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Unknown Vehicle', make: 'Other' }).status, 'matched')

  // Make omitted or null is skipped
  assert.equal(matchRegistration({ text: 'Registration card Subaru Outback', make: null }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration card Subaru Outback', make: undefined }).status, 'matched')

  // Make mismatch
  const makeMismatch = matchRegistration({ text: 'Registration card Ford Mustang', make: 'Toyota' })
  assert.equal(makeMismatch.status, 'mismatch')
  assert.deepEqual(makeMismatch.misses, ['make'])
})

test('matchRegistration model matching and folding', () => {
  // Punctuation and spacing folded: 'F-150' matches 'F 150', 'F150', 'F-150'
  assert.equal(matchRegistration({ text: 'Ford F-150 pickup registration', model: 'F 150' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Ford F 150 pickup registration', model: 'F-150' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Mazda CX-5 SUV registration', model: 'CX5' }).status, 'matched')

  // Model 'other' or 'Other' is exempt
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', model: 'other' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', model: 'Other' }).status, 'matched')

  // Model omitted is skipped
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', model: null }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', model: '' }).status, 'matched')

  // Model mismatch
  const modelMismatch = matchRegistration({ text: 'Registration Toyota Camry 2024', model: 'Corolla' })
  assert.equal(modelMismatch.status, 'mismatch')
  assert.deepEqual(modelMismatch.misses, ['model'])
})

test('matchRegistration color matching and aliases', () => {
  // Gray and Grey aliases
  assert.equal(matchRegistration({ text: 'Toyota Camry gray metallic 2024', color: 'gray' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Toyota Camry grey metallic 2024', color: 'gray' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Toyota Camry gray metallic 2024', color: 'grey' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Toyota Camry grey metallic 2024', color: 'grey' }).status, 'matched')

  // Case folding and multi-word colors
  assert.equal(matchRegistration({ text: 'Honda Civic Dark Blue 2023', color: 'Dark Blue' }).status, 'matched')

  // Color 'other' or 'Other' is exempt
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', color: 'other' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', color: 'Other' }).status, 'matched')

  // Color omitted is skipped
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', color: null }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', color: '' }).status, 'matched')

  // Color mismatch
  const colorMismatch = matchRegistration({ text: 'Registration Honda Civic Red', color: 'Black' })
  assert.equal(colorMismatch.status, 'mismatch')
  assert.deepEqual(colorMismatch.misses, ['color'])
})

test('matchRegistration plate matching and folding', () => {
  // Punctuation and spaces folded in plate
  assert.equal(matchRegistration({ text: 'South Carolina plate SC-987-XYZ valid', plate: 'SC 987 XYZ' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'South Carolina plate SC 987 XYZ valid', plate: 'SC-987-XYZ' }).status, 'matched')
  assert.equal(matchRegistration({ text: 'South Carolina plate SC987XYZ valid', plate: 'sc-987-xyz' }).status, 'matched')

  // Plate omitted is skipped
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', plate: null }).status, 'matched')
  assert.equal(matchRegistration({ text: 'Registration document valid 2026', plate: '' }).status, 'matched')

  // Plate mismatch
  const plateMismatch = matchRegistration({ text: 'South Carolina plate AAA-111 valid', plate: 'BBB-222' })
  assert.equal(plateMismatch.status, 'mismatch')
  assert.deepEqual(plateMismatch.misses, ['plate'])

  // BUG?: plate does not have an 'other' exemption unlike make, model, and color
  const plateOtherMismatch = matchRegistration({ text: 'South Carolina registration document valid', plate: 'other' })
  assert.equal(plateOtherMismatch.status, 'mismatch')
  assert.deepEqual(plateOtherMismatch.misses, ['plate'])
})

test('matchRegistration multiple misses and exact message formatting', () => {
  // Single miss messages
  const makeOnly = matchRegistration({ text: 'South Carolina Honda Civic white ABC1234', make: 'Ford' })
  assert.equal(makeOnly.message, 'Registration does not match the make on your application. Re-upload the registration or correct those vehicle details.')

  const modelOnly = matchRegistration({ text: 'South Carolina Honda Civic white ABC1234', model: 'Accord' })
  assert.equal(modelOnly.message, 'Registration does not match the model on your application. Re-upload the registration or correct those vehicle details.')

  const colorOnly = matchRegistration({ text: 'South Carolina Honda Civic white ABC1234', color: 'Black' })
  assert.equal(colorOnly.message, 'Registration does not match the color on your application. Re-upload the registration or correct those vehicle details.')

  const plateOnly = matchRegistration({ text: 'South Carolina Honda Civic white ABC1234', plate: 'ZZZ999' })
  assert.equal(plateOnly.message, 'Registration does not match the plate on your application. Re-upload the registration or correct those vehicle details.')

  // Two misses
  const twoMisses = matchRegistration({
    text: 'South Carolina Honda Civic white ABC1234',
    make: 'Toyota',
    model: 'Corolla',
  })
  assert.deepEqual(twoMisses.misses, ['make', 'model'])
  assert.equal(twoMisses.message, 'Registration does not match the make, model on your application. Re-upload the registration or correct those vehicle details.')

  // All four misses
  const allFour = matchRegistration({
    text: 'South Carolina Honda Civic white ABC1234',
    make: 'Tesla',
    model: 'Model 3',
    color: 'Red',
    plate: 'EV-1234',
  })
  assert.equal(allFour.status, 'mismatch')
  assert.equal(allFour.matched, false)
  assert.equal(allFour.reviewStatus, 'needs_review')
  assert.deepEqual(allFour.misses, ['make', 'model', 'color', 'plate'])
  assert.equal(
    allFour.message,
    'Registration does not match the make, model, color, plate on your application. Re-upload the registration or correct those vehicle details.'
  )
})

test('matchRegistration happy path and vehicle omission quirk', () => {
  // Full match
  const fullMatch = matchRegistration({
    text: 'Official South Carolina Registration 2026 - Toyota Camry Black Plate 789-QWE',
    make: 'Toyota',
    model: 'Camry',
    color: 'Black',
    plate: '789QWE',
  })
  assert.equal(fullMatch.status, 'matched')
  assert.equal(fullMatch.matched, true)
  assert.equal(fullMatch.reviewStatus, 'matched')
  assert.equal(fullMatch.message, 'Registration matches the vehicle on your application. An admin still approves the driver account.')
  assert.equal(fullMatch.misses, undefined)

  // BUG?: matchRegistration with valid text but all vehicle fields omitted passes as matched with 0 misses
  const omittedVehicle = matchRegistration({
    text: 'Official South Carolina Registration Document 2026',
  })
  assert.equal(omittedVehicle.status, 'matched')
  assert.equal(omittedVehicle.matched, true)
})
