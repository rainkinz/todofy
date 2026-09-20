use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    mpsc, Arc, Mutex,
};

pub struct Capture {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

pub enum Message {
    Start {
        seconds: u32,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Stop {
        reply: mpsc::Sender<Result<Capture, String>>,
    },
    Cancel,
}

pub fn spawn_worker(level: Arc<AtomicU32>) -> mpsc::Sender<Message> {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut active: Option<Recording> = None;
        for message in receiver {
            match message {
                Message::Start { seconds, reply } => {
                    if active.is_some() {
                        let _ = reply.send(Err("Microphone is already recording".into()));
                    } else {
                        match Recording::new(seconds, level.clone()) {
                            Ok(recording) => {
                                active = Some(recording);
                                let _ = reply.send(Ok(()));
                            }
                            Err(error) => {
                                let _ = reply.send(Err(error));
                            }
                        }
                    }
                }
                Message::Stop { reply } => {
                    let result = active
                        .take()
                        .ok_or("No active recording".into())
                        .and_then(Recording::finish);
                    let _ = reply.send(result);
                    level.store(0, Ordering::Relaxed);
                }
                Message::Cancel => {
                    active = None;
                    level.store(0, Ordering::Relaxed);
                }
            }
        }
    });
    sender
}

struct Recording {
    stream: Stream,
    samples: Arc<Mutex<Vec<f32>>>,
    error: Arc<Mutex<Option<String>>>,
    sample_rate: u32,
}

impl Recording {
    fn new(seconds: u32, level: Arc<AtomicU32>) -> Result<Self, String> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or("No microphone is available")?;
        let supported = device
            .default_input_config()
            .map_err(|e| format!("Could not open the microphone: {e}"))?;
        let sample_rate = supported.sample_rate().0;
        let config: StreamConfig = supported.clone().into();
        let channels = config.channels as usize;
        if channels == 0 || sample_rate == 0 {
            return Err("Unsupported microphone format".into());
        }
        let limit = sample_rate as usize * seconds as usize;
        let samples = Arc::new(Mutex::new(Vec::new()));
        let error = Arc::new(Mutex::new(None));
        let callback_samples = samples.clone();
        let callback_level = level.clone();
        let callback_error = error.clone();
        let on_error = move |e: cpal::StreamError| {
            if let Ok(mut slot) = callback_error.lock() {
                *slot = Some(e.to_string());
            }
        };
        let stream = match supported.sample_format() {
            SampleFormat::F32 => device.build_input_stream(
                &config,
                move |input: &[f32], _| {
                    append(
                        input,
                        channels,
                        limit,
                        &callback_samples,
                        &callback_level,
                        |v| v.clamp(-1.0, 1.0),
                    );
                },
                on_error,
                None,
            ),
            SampleFormat::I16 => {
                let sample_buffer = samples.clone();
                let meter = level.clone();
                let err_buffer = error.clone();
                device.build_input_stream(
                    &config,
                    move |input: &[i16], _| {
                        append(input, channels, limit, &sample_buffer, &meter, |v| {
                            v as f32 / 32768.0
                        });
                    },
                    move |e| {
                        if let Ok(mut slot) = err_buffer.lock() {
                            *slot = Some(e.to_string());
                        }
                    },
                    None,
                )
            }
            SampleFormat::U16 => {
                let sample_buffer = samples.clone();
                let meter = level.clone();
                let err_buffer = error.clone();
                device.build_input_stream(
                    &config,
                    move |input: &[u16], _| {
                        append(input, channels, limit, &sample_buffer, &meter, |v| {
                            (v as f32 - 32768.0) / 32768.0
                        });
                    },
                    move |e| {
                        if let Ok(mut slot) = err_buffer.lock() {
                            *slot = Some(e.to_string());
                        }
                    },
                    None,
                )
            }
            _ => return Err("Microphone sample format is not supported".into()),
        }
        .map_err(|e| format!("Could not start microphone capture: {e}"))?;
        stream
            .play()
            .map_err(|e| format!("Microphone permission or playback failed: {e}"))?;
        Ok(Self {
            stream,
            samples,
            error,
            sample_rate,
        })
    }

    fn finish(self) -> Result<Capture, String> {
        drop(self.stream);
        if let Some(error) = self
            .error
            .lock()
            .map_err(|_| "Microphone state failed")?
            .take()
        {
            return Err(format!("Microphone stopped: {error}"));
        }
        let samples =
            std::mem::take(&mut *self.samples.lock().map_err(|_| "Microphone state failed")?);
        if samples.len() < self.sample_rate as usize / 4 {
            return Err("No speech was recorded".into());
        }
        Ok(Capture {
            samples,
            sample_rate: self.sample_rate,
        })
    }
}

fn append<T: Copy>(
    input: &[T],
    channels: usize,
    limit: usize,
    samples: &Arc<Mutex<Vec<f32>>>,
    level: &AtomicU32,
    convert: impl Fn(T) -> f32,
) {
    if let Ok(mut out) = samples.lock() {
        let mut peak = 0.0f32;
        for frame in input.chunks_exact(channels) {
            if out.len() >= limit {
                break;
            }
            let mono = frame.iter().map(|s| convert(*s)).sum::<f32>() / channels as f32;
            peak = peak.max(mono.abs());
            out.push(mono);
        }
        level.store(peak.to_bits(), Ordering::Relaxed);
    }
}

pub fn pcm_16k(capture: &Capture) -> Vec<i16> {
    let output_len = (capture.samples.len() as u64 * 16_000 / capture.sample_rate as u64) as usize;
    (0..output_len)
        .map(|n| {
            let pos = n as f64 * capture.sample_rate as f64 / 16_000.0;
            let index = pos.floor() as usize;
            let fraction = (pos - index as f64) as f32;
            let a = capture.samples[index];
            let b = capture.samples.get(index + 1).copied().unwrap_or(a);
            ((a + (b - a) * fraction).clamp(-1.0, 1.0) * 32767.0) as i16
        })
        .collect()
}

pub fn write_wav(path: &std::path::Path, pcm: &[i16]) -> Result<(), String> {
    use std::io::Write;
    let data_size = u32::try_from(pcm.len() * 2).map_err(|_| "Recording is too large")?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    file.write_all(b"RIFF").map_err(|e| e.to_string())?;
    file.write_all(&(36 + data_size).to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"WAVEfmt ").map_err(|e| e.to_string())?;
    file.write_all(&16u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&16_000u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&32_000u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&2u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(&16u16.to_le_bytes())
        .map_err(|e| e.to_string())?;
    file.write_all(b"data").map_err(|e| e.to_string())?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|e| e.to_string())?;
    for sample in pcm {
        file.write_all(&sample.to_le_bytes())
            .map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resamples_and_writes_pcm() {
        let source = Capture {
            samples: vec![0.0, 0.5, -0.5, 1.0],
            sample_rate: 8_000,
        };
        let result = pcm_16k(&source);
        assert_eq!(result.len(), 8);
        assert_eq!(result[0], 0);
        assert!(result[1] > 0);
        let path =
            std::env::temp_dir().join(format!("todofy-voice-test-{}.wav", uuid::Uuid::new_v4()));
        write_wav(&path, &result).unwrap();
        let wav = std::fs::read(&path).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + result.len() * 2);
        std::fs::remove_file(path).unwrap();
    }
}
