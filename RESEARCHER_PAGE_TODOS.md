# Researcher Page TODOs

## 1 Channel Quality Dashboard
- [x] Rank channels by noise, flatlines, saturation, extreme amplitudes, missing data, variance, and outlier burden.
- [x] Add sortable channel table with quality metrics.
- [x] Add quick links from each channel row to the EEG Viewer.

## 2 Event / Annotation Explorer
- [x] Detect and display events, seizures, stimulation markers, annotations, or marked intervals when present.
- [x] Add event timeline with jump-to-EEG controls.
- [x] Support event-centered trace windows.

## 3 Spectral Viewer
- [ ] Plot power spectrum for selected channel/window.
- [ ] Add spectrogram view.
- [ ] Add band power summaries over time.
- [ ] Highlight line noise and broad frequency abnormalities.

## 4 Montage Builder
- [ ] Support referential and bipolar derivations.
- [ ] Let users define custom channel pairs.
- [ ] Save or copy derived montage definitions.

## 5 Artifact Review
- [ ] Detect likely flat channels, movement bursts, amplifier saturation, high-frequency noise, and 60 Hz contamination.
- [ ] Show artifact candidates in a review table.
- [ ] Add accept/reject/unsure labels for candidate windows.

## 6 Metadata / Cohort Browser
- [ ] Browse subjects, files, channel counts, durations, sample rates, iEEG labels, file sizes, and available modalities.
- [ ] Add filters for subject, duration, channel count, and metadata availability.
- [ ] Link each file to EEG Viewer and H5 Explorer.

## 7 Segment Sampler
- [ ] Generate random or stratified snippets across a file.
- [ ] Add good/bad/unsure labels.
- [ ] Store reviewed snippets for export.

## 8 Seizure / High-Amplitude Candidate Finder
- [ ] Surface windows with unusually high amplitude, rhythmicity, or energy changes.
- [ ] Rank candidate windows by score.
- [ ] Add jump-to-window controls in EEG Viewer.

## 9 Channel Map / Electrode Localization
- [ ] Detect electrode coordinates when available.
- [ ] Visualize electrodes by label, region, hemisphere, grid, strip, or depth grouping.
- [ ] Link electrode selections to traces.

## 10 Export / Labeling Queue
- [ ] Collect reviewed snippets, YES/NO labels, comments, timestamps, subject, file, and channel.
- [ ] Export to Google Sheets-compatible TSV or CSV.
- [ ] Add review status filters and batch export.
