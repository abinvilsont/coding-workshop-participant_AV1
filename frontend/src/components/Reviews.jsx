import { Box, Rating, Stack, Typography } from '@mui/material';
import { RATING_LABELS, formatDateTime, starsLabel, timeAgo } from '../utils/format';

/** Read-only stars with an accessible "4 stars" name. */
export function Stars({ value, size = 'small' }) {
  return <Rating value={value} readOnly precision={0.1} size={size} getLabelText={starsLabel} />;
}

/** One review: stars, who and when, and the comment. `heading` replaces the reviewer line. */
export function ReviewItem({ review, heading }) {
  return (
    <Box component="article" sx={{ p: 1.5, borderRadius: 1, border: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap', mb: review.comment ? 0.5 : 0 }}>
        <Stars value={review.rating} />
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{RATING_LABELS[review.rating]}</Typography>
        <Typography variant="caption" color="text.secondary">
          {heading ?? review.reviewer_name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }} title={formatDateTime(review.updated_at)}>
          {timeAgo(review.created_at)}
        </Typography>
      </Stack>
      {review.comment && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.comment}</Typography>
      )}
    </Box>
  );
}
