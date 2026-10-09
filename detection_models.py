"""Offline Torchvision architecture construction, matching the training notebook."""
import torch
CLASS_NAMES = {0: "__background__", 1: "bus", 2: "uv"}

def build_model(name, pretrained=True, resize=None):
    from torchvision.models.detection import (
        fasterrcnn_resnet50_fpn, FasterRCNN_ResNet50_FPN_Weights,
        ssd300_vgg16, SSD300_VGG16_Weights,
    )
    if name == 'fasterrcnn_resnet50_fpn':
        resize = resize or {'min_size': 512, 'max_size': 768}  # Legacy checkpoint default.
        from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
        model = fasterrcnn_resnet50_fpn(
            weights=FasterRCNN_ResNet50_FPN_Weights.COCO_V1 if pretrained else None,
            weights_backbone=None, **resize,
        )
        features = model.roi_heads.box_predictor.cls_score.in_features
        model.roi_heads.box_predictor = FastRCNNPredictor(features, len(CLASS_NAMES))
        # Torchvision otherwise uses ordinary BatchNorm when weights=None, which
        # would change the architecture on offline reload/resume of a COCO model.
        from torchvision.ops.misc import FrozenBatchNorm2d

        def freeze_norm(module):
            for child_name, child in list(module.named_children()):
                if isinstance(child, torch.nn.BatchNorm2d):
                    frozen = FrozenBatchNorm2d(child.num_features, eps=child.eps)
                    frozen.load_state_dict(child.state_dict())
                    setattr(module, child_name, frozen)
                else:
                    freeze_norm(child)
        freeze_norm(model.backbone)
        for module in model.modules():
            if isinstance(module, FrozenBatchNorm2d):
                module.eps = 0.0  # Matches Torchvision's COCO_V1 checkpoint on offline reload.
    elif name == 'ssd300_vgg16':
        from torchvision.models.detection.ssd import SSDClassificationHead
        model = ssd300_vgg16(weights=SSD300_VGG16_Weights.COCO_V1 if pretrained else None, weights_backbone=None)
        channels = [layer.in_channels for layer in model.head.classification_head.module_list]
        anchors = model.anchor_generator.num_anchors_per_location()
        model.head.classification_head = SSDClassificationHead(channels, anchors, len(CLASS_NAMES))
    else:
        raise ValueError(f'Unknown model: {name}')
    # Same fine-tuning policy on initial training and checkpoint resume.
    for parameter in model.parameters():
        parameter.requires_grad_(True)
    return model
