package jobs

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	jobv1 "github.com/smartcontractkit/chainlink-protos/job-distributor/v1/job"
	"github.com/smartcontractkit/chainlink-protos/job-distributor/v1/shared/ptypes"

	cldf "github.com/smartcontractkit/chainlink-deployments-framework/deployment"

	"github.com/smartcontractkit/chainlink/deployment/data-streams/jd"
	"github.com/smartcontractkit/chainlink/deployment/data-streams/jobs"
	"github.com/smartcontractkit/chainlink/deployment/data-streams/utils"
	"github.com/smartcontractkit/chainlink/deployment/data-streams/utils/pointer"
	"github.com/smartcontractkit/chainlink/deployment/environment/devenv"
)

var _ cldf.ChangeSetV2[CsDistributeStreamJobSpecsConfig] = CsDistributeStreamJobSpecs{}

type CsDistributeStreamJobSpecsConfig struct {
	Filter  *jd.ListFilter
	Streams []jobs.StreamSpecConfig
	Labels  []*ptypes.Label

	// NodeNames specifies on which nodes to distribute the job specs.
	NodeNames []string
}

type CsDistributeStreamJobSpecs struct{}

func (CsDistributeStreamJobSpecs) Apply(e cldf.Environment, cfg CsDistributeStreamJobSpecsConfig) (cldf.ChangesetOutput, error) {
	ctx, cancel := context.WithTimeout(e.GetContext(), defaultJobSpecsTimeout)
	defer cancel()

	// Add a label to the job spec to identify the related DON
	cfg.Labels = append(cfg.Labels,
		&ptypes.Label{
			Key: utils.DonIDLabel(cfg.Filter.DONID, cfg.Filter.DONName),
		},
		&ptypes.Label{
			Key:   devenv.LabelJobTypeKey,
			Value: pointer.To(devenv.LabelJobTypeValueStream),
		},
	)

	oracleNodes, err := jd.FetchDONOraclesFromJD(ctx, e.Offchain, cfg.Filter, cfg.NodeNames)
	if err != nil {
		return cldf.ChangesetOutput{}, fmt.Errorf("failed to get oracle nodes: %w", err)
	}

	var proposals []*jobv1.ProposeJobRequest
	for _, s := range cfg.Streams {
		// Start with the common labels.
		streamLabels := append([]*ptypes.Label{}, cfg.Labels...)
		// Some streams might not have an ID.
		if s.StreamID > 0 {
			streamLabels = append(streamLabels, &ptypes.Label{
				Key:   utils.StreamIDLabel(s.StreamID),
				Value: pointer.To(s.Name),
			})
		}
		virtualStreamIDLabels, err := streamIDLabelsFromReportFields(s.ReportFields)
		if err != nil {
			return cldf.ChangesetOutput{}, fmt.Errorf("failed to get streamID labels: %w", err)
		}
		streamLabels = append(streamLabels, virtualStreamIDLabels...)

		for _, n := range oracleNodes {
			// Check if there is already a job spec for this stream on this node:
			streamID := s.StreamID
			if streamID == 0 {
				if len(virtualStreamIDLabels) == 0 {
					return cldf.ChangesetOutput{}, fmt.Errorf("no top level or virtual streamID found for stream %s", s.Name)
				}
				streamID, err = utils.StreamIDFromLabel(virtualStreamIDLabels[0].Key)
				if err != nil {
					return cldf.ChangesetOutput{}, fmt.Errorf("failed to parse streamID from label: %w", err)
				}
			}
			// Check if there is already a job spec for this stream on this node:
			externalJobID, err := fetchExternalJobID(e, n.Id, []*ptypes.Selector{
				{
					Key: utils.StreamIDLabel(streamID),
					Op:  ptypes.SelectorOp_EXIST,
				},
			})
			if err != nil {
				return cldf.ChangesetOutput{}, fmt.Errorf("failed to get externalJobID: %w", err)
			}

			if s.Generator == nil {
				s.Generator, err = jobs.GeneratorForStreamType(s.StreamType)
				if err != nil {
					return cldf.ChangesetOutput{}, fmt.Errorf("failed to get generator for stream type %s: %w", s.StreamType, err)
				}
			}
			spec, err := s.Generator.GenerateJobSpec(s, externalJobID)

			if err != nil {
				return cldf.ChangesetOutput{}, fmt.Errorf("failed to create stream job spec: %w", err)
			}
			renderedSpec, err := spec.MarshalTOML()
			if err != nil {
				return cldf.ChangesetOutput{}, fmt.Errorf("failed to marshal stream job spec: %w", err)
			}

			proposals = append(proposals, &jobv1.ProposeJobRequest{
				NodeId: n.Id,
				Spec:   string(renderedSpec),
				Labels: streamLabels,
			})
		}
	}

	proposedJobs, err := proposeAllOrNothing(ctx, e.Offchain, proposals)
	if err != nil {
		return cldf.ChangesetOutput{}, fmt.Errorf("failed to propose all oracle jobs: %w", err)
	}

	return cldf.ChangesetOutput{
		Jobs: proposedJobs,
	}, nil
}

// streamIDLabelsFromReportFields returns a list of labels for the virtual streamIDs from the report fields.
// This function does NOT return nil, it returns an empty slice if no labels are found.
func streamIDLabelsFromReportFields(rf jobs.ReportFields) ([]*ptypes.Label, error) {
	labels := []*ptypes.Label{}

	switch rf := rf.(type) {
	case jobs.MedianReportFields:
		l, err := streamIDLabelsFor(rf.Benchmark.StreamID)
		if err != nil {
			return nil, err
		}
		labels = append(labels, l...)

	case jobs.QuoteReportFields:
		l, err := streamIDLabelsFor(rf.Benchmark.StreamID)
		if err != nil {
			return nil, err
		}
		labels = append(labels, l...)
		l, err = streamIDLabelsFor(rf.Bid.StreamID)
		if err != nil {
			return nil, err
		}
		labels = append(labels, l...)
		l, err = streamIDLabelsFor(rf.Ask.StreamID)
		if err != nil {
			return nil, err
		}
		labels = append(labels, l...)

	default:
		return nil, fmt.Errorf("unknown report fields type: %T", rf)
	}

	return labels, nil
}

// streamIDLabelsFor returns a list of labels for the streamID.
// We intentionally return a list, so we can return an empty one.
func streamIDLabelsFor(sid *string) ([]*ptypes.Label, error) {
	if sid == nil {
		// It's fine to not have a streamID in the report fields.
		return nil, nil
	}
	id, err := strconv.ParseUint(*sid, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("failed to parse streamID: %w", err)
	}
	return []*ptypes.Label{
		{
			Key: utils.StreamIDLabel(uint32(id)),
		},
	}, nil
}

func (f CsDistributeStreamJobSpecs) VerifyPreconditions(_ cldf.Environment, config CsDistributeStreamJobSpecsConfig) error {
	if config.Filter == nil {
		return errors.New("filter is required")
	}
	if config.Filter.DONID == 0 || config.Filter.DONName == "" {
		return errors.New("DONID and DONName are required")
	}
	if len(config.Streams) == 0 {
		return errors.New("streams are required")
	}
	for _, s := range config.Streams {
		if s.StreamID == 0 {
			return errors.New("streamID is required for each stream")
		}
		if s.Name == "" {
			return errors.New("name is required for each stream")
		}
		if !s.StreamType.Valid() {
			return errors.New("stream type is not valid")
		}
		if s.ReportFields == nil {
			return errors.New("report fields are required for each stream")
		}
		if s.EARequestParams.Endpoint == "" {
			return errors.New("endpoint is required for each EARequestParam on each stream")
		}
		if len(s.APIs) == 0 {
			return errors.New("at least one API is required for each stream")
		}
	}
	if len(config.NodeNames) == 0 {
		return errors.New("at least one node name is required")
	}
	// The list of node names tells us which nodes to distribute the job specs to.
	// The size of that list needs to match the filter size, i.e. the number of nodes we expect to get from JD.
	if config.Filter.NumOracleNodes != len(config.NodeNames) {
		return fmt.Errorf("number of node names (%d) does not match filter size (%d)", len(config.NodeNames), config.Filter.NumOracleNodes)
	}

	return nil
}
