"""Export trained Torchvision checkpoints without retraining or network downloads."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import torch
import onnx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from detection_runtime import Adapter


class ExportModel(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, images):
        result = self.model([images[0]])[0]
        return result['boxes'], result['labels'], result['scores']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('model', choices=['fasterrcnn_resnet50_fpn', 'ssd300_vgg16'])
    args = parser.parse_args()
    torch.set_num_threads(2)
    adapter = Adapter(args.model, 'cpu')
    folder = ROOT / 'trained_models' / args.model / 'AMD'
    folder.mkdir(exist_ok=True)
    path = folder / 'best.onnx'
    temporary = folder / 'exporting.onnx'
    model = ExportModel(adapter.model).eval()
    with torch.no_grad():
        torch.onnx.export(model, torch.zeros(1, 3, 416, 416), str(temporary),
                          input_names=['images'], output_names=['boxes', 'labels', 'scores'],
                          opset_version=17, dynamo=False,
                          dynamic_axes={'boxes': {0: 'detections'}, 'labels': {0: 'detections'},
                                        'scores': {0: 'detections'}})
    graph = onnx.load(str(temporary))
    onnx.checker.check_model(graph)
    onnx.helper.set_model_props(graph, {'architecture': args.model, 'preprocessing': 'rgb_stretch_416',
                                      'class_names': json.dumps({'1': 'bus', '2': 'uv'}),
                                      'source_sha256': hashlib.sha256((folder.parent / 'best.pth').read_bytes()).hexdigest()})
    # A different path avoids overwriting a file held by ONNX's Windows loader.
    tagged = folder / 'tagged.onnx'
    onnx.save(graph, str(tagged))
    tagged.replace(path)
    print('Exported:', path, flush=True)


if __name__ == '__main__':
    main()
